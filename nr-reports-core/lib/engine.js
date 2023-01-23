'use strict'

const nunjucks = require('nunjucks'),
  fetch = require('node-fetch'),
  PDFMerger = require('pdf-merger-js'),
  showdown = require('showdown'),
  { createWriteStream } = require('fs'),
  path = require('path'),
  { pipeline } = require('stream'),
  { promisify } = require('util'),
  { publish, getChannelDefaults } = require('./channels'),
  { createLogger } = require('./logger'),
  NrqlExtension = require('./extensions/nrql-extension'),
  ChartExtension = require('./extensions/chart-extension'),
  DumpContextExtension = require('./extensions/dump-context-extension'),
  { NerdgraphClient } = require('./nerdgraph'),
  {
    loadFile,
    parseManifest,
    parseJson,
    getFilenameWithNewExtension,
    withTempDir,
    getOption,
    DEFAULT_CHANNEL,
    splitPaths,
  } = require('./util'),
  {
    getS3ObjectAsString,
  } = require('./aws-util')

const logger = createLogger('engine'),
  converter = new showdown.Converter({
    ghCompatibleHeaderId: true,
    strikethrough: true,
    tables: true,
    tablesHeaderId: true,
    tasklists: true,
    openLinksInNewWindow: true,
    backslashEscapesHTMLTags: true,
  }),
  streamPipeline = promisify(pipeline)

converter.setFlavor('github')

async function renderPdf(browser, content, file) {
  logger.verbose(`Creating new browser page to render PDF to ${file}...`)

  const page = await browser.newPage()

  page
    .on('console', message => logger.verbose(`chrome-console: ${message.type().slice(0, 3).toUpperCase()} ${message.text()}`))
    .on('pageerror', ({ message }) => logger.error(`chrome-pageerror: ${message}`))
    .on('response', response => logger.verbose(`chrome-response: ${response.status()} ${response.url()}`))
    .on('requestfailed', request => logger.error(`chrome-requestfailed: ${request.failure()} ${request.url()}`))

  logger.debug((log, format) => {
    log(format('Dumping HTML content:'))
    log(content)
  })

  await page.setContent(
    content,
    {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
    },
  )

  logger.verbose(`Saving PDF to ${file}...`)

  await page.pdf({
    path: file,
    format: 'Letter',
    margin: {
      top: '20px',
      left: '40px',
      bottom: '20px',
      right: '40px',
    },
  })
}

function renderTemplateFromFile(file, context = {}) {
  return new Promise((resolve, reject) => {
    logger.verbose(`Rendering file template named ${file}...`)

    logger.debug((log, format) => {
      log(format('Context:'))
      log(context)
    })

    nunjucks.render(file, context, (err, res) => {
      if (err) {
        reject(err)
        return
      }

      resolve(res)
    })
  })
}

function renderTemplateFromString(template, context = {}) {
  return new Promise((resolve, reject) => {
    logger.verbose('Rendering template content...')

    logger.debug((log, format) => {
      log(format('Context:'))
      log(context)
    })

    nunjucks.renderString(template, context, (err, res) => {
      if (err) {
        reject(err)
        return
      }

      resolve(res)
    })
  })
}

async function downloadDashboardPdf(apiKey, dashboard, downloadDir) {
  const query = `{
      dashboardCreateSnapshotUrl(guid: $guid)
    }`,
    options = {
      nextCursonPath: null,
      mutation: true,
      headers: {},
    },
    nerdgraph = new NerdgraphClient(),
    results = await nerdgraph.query(
      apiKey,
      query,
      { guid: ['EntityGuid!', dashboard] },
      options,
    ),
    dashboardPdfFileName = path.join(
      downloadDir,
      `dashboard-${dashboard}.pdf`,
    ),
    dashboardUrl = results[0].dashboardCreateSnapshotUrl

  // todo: check for errors

  logger.verbose(`Fetching dashboard ${dashboardUrl}...`)

  const response = await fetch(dashboardUrl)

  if (!response.ok) {
    throw new Error(`Download PDF at ${dashboardUrl} failed: status=${response.status}`)
  }

  logger.verbose(`Writing PDF to ${dashboardPdfFileName}...`)
  await streamPipeline(response.body, createWriteStream(dashboardPdfFileName))
  logger.verbose(`Wrote PDF to ${dashboardPdfFileName}...`)

  return dashboardPdfFileName
}

async function mergePdfs(dashboardPdfs, consolidatedPdf) {
  const merger = new PDFMerger()

  logger.verbose((log, format) => {
    log(format(`Merging ${dashboardPdfs.length} PDFs to ${consolidatedPdf}...`))
    dashboardPdfs.forEach(pdf => log(format(pdf)))
  })

  dashboardPdfs.forEach(dashboard => merger.add(dashboard))

  logger.verbose(`Creating consolidated PDF ${consolidatedPdf}...`)
  await merger.save(consolidatedPdf)
}

function makeChannel(type, options) {
  return getChannelDefaults(type || DEFAULT_CHANNEL, options)
}

function parseChannels(options, channels) {
  logger.debug((log, format) => {
    log(format('Parsing channels:'))
    log(channels)
  })

  const data = channels.split(/[\s]*,[\s]*/u).map(
    type => makeChannel(type, options),
  )

  logger.debug((log, format) => {
    log(format('Parsed channels:'))
    log(JSON.stringify(data, null, 2))
  })

  return data
}

function getChannels(defaultChannelType, options) {
  const channels = getOption(options, 'channelIds', 'CHANNEL_IDS')

  if (!channels || channels.length === 0) {
    return [makeChannel(defaultChannelType, options)]
  }

  const data = parseChannels(options, channels)

  return data.length !== 0 ? data : [makeChannel(defaultChannelType, options)]
}

async function loadManifest(
  loadFile,
  manifestFile,
  defaultChannel,
  values,
  extras,
) {
  return (parseManifest(
    await loadFile(manifestFile),
    defaultChannel,
  )).map(report => {
    if (report.templateName) {
      if (values && values[report.name]) {
        return {
          ...report,
          parameters: {
            ...report.parameters,
            ...values[report.name],
          },
          ...extras,
        }
      }
    }

    if (extras) {
      return { ...report, ...extras }
    }

    return report
  })
}

async function discoverReportsHelper(
  options,
  values,
  loadFile,
  defaultChannel,
  defaultChannelType,
  extras,
) {
  const manifestFile = getOption(options, 'manifestFilePath', 'MANIFEST_FILE_PATH')

  // Name of manifest file
  if (manifestFile) {
    logger.debug(`Found manifest file ${manifestFile}.`)

    return await loadManifest(
      loadFile,
      manifestFile,
      defaultChannel,
      values,
      extras,
    )
  }

  const templateName = getOption(options, 'templateName', 'TEMPLATE_NAME')

  // Name of template file
  if (templateName) {
    logger.debug(`Found template name ${templateName}.`)

    const valuesFile = getOption(options, 'valuesFilePath', 'VALUES_FILE_PATH'),
      channels = getChannels(defaultChannelType, options)

    if (valuesFile) {

      // Do not allow values file to override options
      // eslint-disable-next-line no-unused-vars
      const { options: ignore, ...rest } = parseJson(loadFile(valuesFile))

      return [{
        templateName,
        parameters: { ...rest, ...values },
        channels,
        ...extras,
      }]
    }

    return [{
      templateName,
      parameters: values || {},
      channels,
      ...extras,
    }]
  }

  const dashboards = getOption(options, 'dashboardIds', 'DASHBOARD_IDS')

  // Array or comma-delimited list of dashboard GUIDs
  if (dashboards) {
    logger.debug(`Found dashboards ${dashboards}.`)

    const dashboardGuids = (
        Array.isArray(dashboards) ? dashboards : dashboards.split(/[\s]*,[\s]*/u)
      ),
      channels = getChannels(defaultChannelType, options)

    return [{
      dashboards: dashboardGuids,
      channels,
      ...extras,
    }]
  }

  logger.debug('Using default manifest.')

  // Try to load a default manifest from local storage
  return await loadManifest(
    loadFile,
    'manifest.json',
    defaultChannel,
    values,
    extras,
  )
}

async function discoverReports(context, args) {
  if (Array.isArray(args)) {
    logger.debug('Args is an array of reports.')
    return args
  }

  const {
      options,
      ...values
    } = args,
    sourceBucket = getOption(options, 'sourceBucket', 'S3_SOURCE_BUCKET')

  if (sourceBucket) {
    logger.debug(`Found sourceBucket ${sourceBucket}.`)

    return await discoverReportsHelper(
      options,
      values,
      async filePath => await getS3ObjectAsString(sourceBucket, filePath)
      ),
      () => makeChannel('s3', options),
      's3',
      {
        S3Bucket: sourceBucket,
      },
    )
  }

  logger.debug('No sourceBucket found.')

  return await discoverReportsHelper(
    options,
    values,
    async filePath => await loadFile(filePath),
    () => makeChannel(context.defaultChannelType, options),
  )
}

async function renderTemplateReport(
  report,
  tempDir,
  browser,
  renderer,
) {
  const {
      templateName,
      parameters,
      isMarkdown,
    } = report,
    templateParameters = parameters || {}
  let templateIsMarkdown = isMarkdown

  try {
    const output = path.join(
      tempDir,
      getFilenameWithNewExtension(templateName, 'pdf'),
    )

    logger.verbose(`Rendering ${templateName} to ${output}...`)

    if (typeof templateIsMarkdown === 'undefined') {
      templateIsMarkdown = (path.extname(templateName.toLowerCase()) === '.md')
    }

    logger.verbose(`templateIsMarkdown: ${templateIsMarkdown}`)

    templateParameters.isMarkdown = templateIsMarkdown

    let content = await renderer(templateName, templateParameters)

    if (templateIsMarkdown) {
      content = await renderTemplateFromString(
        `{% extends "base/report.md.html" %} {% block content %}${converter.makeHtml(content)}{% endblock %}`,
        templateParameters,
      )
    }

    await renderPdf(
      browser,
      content,
      output,
    )

    await publish(report, [output])
  } catch (err) {
    logger.error(err)
  }
}
class Engine {
  constructor(options) {
    const env = nunjucks.configure(options.templatesPath || null)

    env.addExtension('NrqlExtension', new NrqlExtension(options.apiKey))
    env.addExtension('ChartExtension', new ChartExtension(options.apiKey))
    env.addExtension('DumpContextExtension', new DumpContextExtension())

    this.apiKey = options.apiKey
    this.env = env
    this.browser = options.browser
  }

  async runTemplateReport(report, tempDir) {
    await renderTemplateReport(
      report,
      tempDir,
      this.browser,
      async (templateName, parameters) => (
        await renderTemplateFromFile(templateName, parameters)
      ),
    )
  }

  async runTemplateReportWithContent(report, templateContent, tempDir) {
    await renderTemplateReport(
      report,
      tempDir,
      this.browser,
      async (templateName, parameters) => (
        await renderTemplateFromString(templateContent, parameters)
      ),
    )
  }

  async runDashboardReport(report, tempDir) {
    let consolidatedPdf

    try {
      const {
        dashboards,
        combinePdfs,
      } = report

      logger.verbose(`Running dashboard report for dashboards [${dashboards}]...`)

      const promises = dashboards.map(async dashboard => (
          await downloadDashboardPdf(this.apiKey, dashboard, tempDir)
        )),
        dashboardPdfs = await Promise.all(promises)

      if (combinePdfs && dashboardPdfs.length > 1) {
        consolidatedPdf = path.join(tempDir, 'consolidated_dashboards.pdf')
        await mergePdfs(dashboardPdfs, consolidatedPdf)
      }

      await publish(
        report,
        combinePdfs ? [consolidatedPdf] : dashboardPdfs,
      )
    } catch (err) {
      logger.error(err)
    }
  }
}

class EngineRunner {
  constructor(context) {
    this.context = context
  }

  async run(args) {
    logger.debug((log, format) => {
      log(format('Invoked with context:'))
      log(this.context)

      log(format('Invoked with arguments:'))
      log(args)

      log(format('Invoked with environment:'))
      log(process.env)
    })

    let browser

    try {

      const reports = await discoverReports(this.context, args)

      if (!reports || reports.length === 0) {
        // eslint-disable-next-line no-console
        console.error('No reports selected.')
        throw new Error('No reports selected.')
      }

      logger.verbose(`Running ${reports.length} reports...`)

      logger.debug((log, format) => {
        log(format('Reports:'))
        log(reports)
      })

      const reportIndex = reports.findIndex(report => (
          report.templateName && (!report.type || report.type === 'text/html')
        )),
        engineOptions = {
          apiKey: this.context.apiKey,
          templatesPath: null,
          browser: null,
        }

      if (reportIndex >= 0) {
        logger.debug('Found 1 or more template reports. Launching browser...')

        const puppetArgs = await this.context.getPuppetArgs(),
          templatePath = getOption(args.options, 'templatePath', 'TEMPLATE_PATH')
        let templatesPath = ['.', 'include', 'templates']

        if (templatePath) {
          templatesPath = templatesPath.concat(splitPaths(templatePath))
        }

        logger.debug((log, format) => {
          log(format(`Final templates path: ${templatesPath}`))

          log(format('Launching browser using the following args:'))
          log(puppetArgs)
        })

        engineOptions.templatesPath = templatesPath
        engineOptions.browser = browser = (
          await this.context.openChrome(puppetArgs)
        )
      }

      await withTempDir(async tempDir => {
        const engine = new Engine(engineOptions)

        for (let index = 0; index < reports.length; index += 1) {
          const report = reports[index]

          logger.verbose(`Running report ${report.name || index}...`)

          if (report.templateName) {
            if (report.S3Bucket) {
              const template = await getS3ObjectAsString(
                report.S3Bucket,
                report.templateName,
              )

              await engine.runTemplateReportWithContent(
                report,
                template,
                tempDir,
              )
              continue
            }

            await engine.runTemplateReport(report, tempDir)
            continue
          } else if (report.dashboards) {
            await engine.runDashboardReport(report, tempDir)
            continue
          }

          logger.warn(`Unrecognized report schema or missing required properties for report ${report.name || index}. Ignoring.`)
        }
      })
    } finally {
      if (browser) {
        await this.context.closeChrome(browser)
      }
    }
  }
}


module.exports = { EngineRunner, Engine }
