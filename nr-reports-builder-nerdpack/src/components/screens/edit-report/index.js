import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import {
  Button,
  Form,
  HeadingText,
  Select,
  SelectItem,
  Stack,
  StackItem,
  TextField,
  Toast,
} from 'nr1'
import DashboardsField from '../../dashboards-field'
import PublishConfigurationsField from '../../publish-configs-field'
import QueryField from '../../query-field'
import {
  RouteContext,
  RouteDispatchContext,
  StorageContext,
} from '../../../contexts'
import { useManifestWriter } from '../../../hooks'
import { clone } from '../../../utils'
import {
  SYMBOLS,
  UI_CONTENT,
} from '../../../constants'

function reportToFormState(report) {
  return {
    error: null,
    name: report.name,
    type: report.query ? (
      SYMBOLS.REPORT_TYPES.QUERY
    ) : SYMBOLS.REPORT_TYPES.DASHBOARD,
    query: report.query,
    accountIds: report.accountIds,
    lastModifiedDate: report.lastModifiedDate,
    publishConfigs: report.publishConfigs ? clone(report.publishConfigs) : {},
    metadata: report.metadata || {},
    loadedDashboards: report.dashboards ? false : true,
    dirty: false,
  }
}

function reportFromFormState(formState) {
  const report = {
    name: formState.name,
    lastModifiedDate: new Date().getTime(),
    schedule: formState.schedule,
    publishConfigs: formState.publishConfigs,
    metadata: formState.metadata,
  }

  if (formState.type === 'query') {
    report.query = formState.query
    report.accountIds = formState.accountIds.map(a => a.value)
  } else {
    report.dashboards = formState.dashboards.map(d => d[0])
  }

  return report
}

export default function EditReportScreen() {
  const {
      params: { accountId, selectedReportIndex, formState: subFormState }
    } = useContext(RouteContext),
    { home } = useContext(RouteDispatchContext),
    {
      manifest,
      writing,
      writeError,
      writeFinished,
    } = useContext(StorageContext),
    { update } = useManifestWriter(),
    report = selectedReportIndex >= 0 ? (
      manifest.reports[selectedReportIndex]
    ) : ({
      name: '',
      lastModifiedDate: 0,
      schedule: '',
      dashboards: [],
      channels: [],
    }),
    prevState = useMemo(() => {
      return subFormState || reportToFormState(report)
    }, [subFormState, report]),
    [formState, setFormState] = useState(prevState),
    [closeOnSave, setCloseOnSave] = useState(false),
    updateFormState = useCallback((updates, dirty) => {
      setFormState({
        ...formState,
        ...updates,
        dirty: typeof dirty === 'undefined' ? true : dirty
      })
    }, [formState, setFormState] ),
    handleChangeName = useCallback(e => {
      updateFormState({ name: e.target.value })
    }, [updateFormState]),
    handleChangeType = useCallback((_, v) => {
      updateFormState({ type: v })
    }, [updateFormState]),
    handleSave = useCallback(() => {
      update(reportFromFormState(formState), selectedReportIndex)
    }, [update, selectedReportIndex, formState]),
    handleClose = useCallback(() => {
      if (formState.dirty) {
        if (!confirm(UI_CONTENT.EDIT_REPORT_SCREEN.CANCEL_PROMPT)) {
          return
        }
      }

      home()
    }, [home, formState]),
    handleSaveAndClose = useCallback(() => {
      setCloseOnSave(true)
      handleSave()
    }, [setCloseOnSave, handleSave]),
    { error } = formState

  useEffect(() => {
    if (error) {
      Toast.showToast({
        title: UI_CONTENT.EDIT_REPORT_FORM.FORM_ERROR_HEADING,
        description: UI_CONTENT.EDIT_REPORT_FORM.FORM_ERROR_DESCRIPTION(error.message),
        actions: [
          {
            label: UI_CONTENT.GLOBAL.ACTION_LABEL_RETRY,
            onClick: handleSave,
          },
        ],
        type: Toast.TYPE.CRITICAL,
      })
    }

    if (writeError) {
      Toast.showToast({
        title: UI_CONTENT.EDIT_REPORT_FORM.SAVE_ERROR_TITLE,
        description: UI_CONTENT.EDIT_REPORT_FORM.SAVE_ERROR_DESCRIPTION(writeError.message),
        actions: [
          {
            label: UI_CONTENT.GLOBAL.ACTION_LABEL_RETRY,
            onClick: handleSave,
          },
        ],
        type: Toast.TYPE.CRITICAL,
      })
    }

    if (writeFinished) {
      Toast.showToast({
        title: UI_CONTENT.EDIT_REPORT_FORM.SAVE_SUCCESS_TITLE,
        description: UI_CONTENT.EDIT_REPORT_FORM.SAVE_SUCCESS_DESCRIPTION(formState.name),
        type: Toast.TYPE.NORMAL,
      })

      updateFormState({}, false)

      if (closeOnSave) {
        home()
      }
    }
  }, [error, writeError, writeFinished, formState.name, updateFormState, handleSave, handleClose, home])

  return (
      <Form
        className="edit-report-form"
        spacingType={[Form.SPACING_TYPE.LARGE]}
      >
        <HeadingText
          type={HeadingText.TYPE.HEADING_2}
          spacingType={[
            HeadingText.SPACING_TYPE.OMIT,
            HeadingText.SPACING_TYPE.OMIT,
            HeadingText.SPACING_TYPE.LARGE,
            HeadingText.SPACING_TYPE.OMIT,
          ]}
        >
          {UI_CONTENT.EDIT_REPORT_FORM.HEADING}
        </HeadingText>

        <Stack
          spacingType={[
            Stack.SPACING_TYPE.NONE,
          ]}
          directionType={Stack.DIRECTION_TYPE.VERTICAL}
          fullWidth
        >
          <StackItem>
            <TextField
              placeholder={
                UI_CONTENT.EDIT_REPORT_FORM.REPORT_NAME_FIELD_PLACEHOLDER
              }
              label={UI_CONTENT.EDIT_REPORT_FORM.FIELD_LABEL_NAME}
              value={formState.name}
              onChange={handleChangeName}
            />
          </StackItem>

          <StackItem>
            <Select
              label={UI_CONTENT.EDIT_REPORT_FORM.FIELD_LABEL_TYPE}
              onChange={handleChangeType}
              value={formState.type}
            >
              <SelectItem value={SYMBOLS.REPORT_TYPES.DASHBOARD}>
                {UI_CONTENT.EDIT_REPORT_FORM.REPORT_TYPE_LABEL_DASHBOARD}
              </SelectItem>
              <SelectItem value={SYMBOLS.REPORT_TYPES.QUERY}>
                {UI_CONTENT.EDIT_REPORT_FORM.REPORT_TYPE_LABEL_QUERY}
              </SelectItem>
            </Select>
          </StackItem>

          <StackItem className="form-wrapper">
            {
              formState.type === SYMBOLS.REPORT_TYPES.DASHBOARD ? (
                <DashboardsField
                  report={report}
                  formState={formState}
                  updateFormState={updateFormState}
                />
              ) : (
                <QueryField
                  report={report}
                  formState={formState}
                  updateFormState={updateFormState}
                />
              )
            }
          </StackItem>

          <StackItem className="form-wrapper">
            <PublishConfigurationsField
              accountId={accountId}
              formState={formState}
              updateFormState={updateFormState}
            />
          </StackItem>

          <StackItem>
            <Stack
              spacingType={[
                Stack.SPACING_TYPE.LARGE,
                Stack.SPACING_TYPE.NONE,
              ]}
            >
              <StackItem>
                <Button
                  onClick={handleSave}
                  type={Button.TYPE.PRIMARY}
                  loading={writing}
                  spacingType={[
                    Button.SPACING_TYPE.NONE,
                    Button.SPACING_TYPE.SMALL,
                    Button.SPACING_TYPE.NONE,
                    Button.SPACING_TYPE.NONE,
                  ]}
                >
                  {UI_CONTENT.GLOBAL.ACTION_LABEL_SAVE}
                </Button>
                <Button
                  onClick={handleSaveAndClose}
                  type={Button.TYPE.SECONDARY}
                  loading={writing}
                  spacingType={[
                    Button.SPACING_TYPE.NONE,
                    Button.SPACING_TYPE.SMALL,
                    Button.SPACING_TYPE.NONE,
                    Button.SPACING_TYPE.NONE,
                  ]}
                >
                  {UI_CONTENT.GLOBAL.ACTION_LABEL_SAVE_AND_CLOSE}
                </Button>
                <Button
                  onClick={handleClose}
                  type={Button.TYPE.TERTIARY}
                  spacingType={[
                    Button.SPACING_TYPE.NONE,
                    Button.SPACING_TYPE.SMALL,
                    Button.SPACING_TYPE.NONE,
                    Button.SPACING_TYPE.NONE,
                  ]}
                >
                  {UI_CONTENT.GLOBAL.ACTION_LABEL_CLOSE}
                </Button>
              </StackItem>
            </Stack>
          </StackItem>

        </Stack>
      </Form>
  )
}
