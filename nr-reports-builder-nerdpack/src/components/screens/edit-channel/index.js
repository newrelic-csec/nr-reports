import React, { useCallback, useContext } from 'react'
import PropTypes from 'prop-types'
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  Form,
  HeadingText,
  Layout,
  LayoutItem,
  Select,
  SelectItem,
  Stack,
  StackItem,
} from 'nr1'
import EmailChannelForm from "../../email-channel-form"
import SlackChannelForm from "../../slack-channel-form"
import {
  RouteContext,
  RouteDispatchContext,
} from '../../../contexts'
import {
  ROUTES,
  SYMBOLS,
  UI_CONTENT,
} from '../../../constants'
import { clone } from '../../../utils'
import { FormContext, Validation, withFormContext } from '../../../contexts/form'
import { channelTypeIsValid } from '../../validations'

function formStateFromChannel(parentFormState, selectedChannel) {
  let channel

  if (parentFormState.channels[selectedChannel]) {
    const selected = parentFormState.channels[selectedChannel]

    if (selected.type === SYMBOLS.CHANNEL_TYPES.EMAIL) {
      channel = {
        type: SYMBOLS.CHANNEL_TYPES.EMAIL,
        emailFormat: selected.format || SYMBOLS.EMAIL_FORMATS.HTML,
        emailQueryDeliveryMethod: selected.attachOutput ? (
          SYMBOLS.EMAIL_CHANNEL_FIELDS.ATTACH_OUTPUT
        ) : (
          selected.passThrough ? (
            SYMBOLS.EMAIL_CHANNEL_FIELDS.PASS_THROUGH
          ) : (
            SYMBOLS.EMAIL_CHANNEL_FIELDS.ATTACH_OUTPUT
          )
        ),
        emailSubject: selected.subject,
        emailTo: selected.to ? selected.to.replaceAll(/\s*,\s*/ug,"\n") : '',
        emailCc: selected.cc ? selected.cc.replaceAll(/\s*,\s*/ug,',') : '',
        emailTemplate: selected.emailTemplate || '',
      }
    } else if (selected.type === SYMBOLS.CHANNEL_TYPES.SLACK) {
      channel = {
        type: SYMBOLS.CHANNEL_TYPES.SLACK,
        slackWebhookUrl: selected.webhookUrl,
      }
    }
  } else {
    channel = {
      type: SYMBOLS.CHANNEL_TYPES.EMAIL,
      emailFormat: SYMBOLS.EMAIL_FORMATS.HTML,
      emailQueryDeliveryMethod: SYMBOLS.EMAIL_CHANNEL_FIELDS.ATTACH_OUTPUT,
      emailSubject: '',
      emailTo: '',
      emailCc: '',
      emailTemplate: '',
    }
  }

  return {
    parentFormState: clone(parentFormState),
    ...channel,
    dirty: false,
    valid: true,
  }
}

function channelFromFormState(formState, selectedChannel) {
  const channels = [ ...formState.parentFormState.channels ],
    channel = channels[selectedChannel] || { type: SYMBOLS.CHANNEL_TYPES.EMAIL }

  if (formState.type === SYMBOLS.CHANNEL_TYPES.EMAIL) {
    channel.type = SYMBOLS.CHANNEL_TYPES.EMAIL,
    channel.format = formState.emailFormat,
    channel.attachOutput = (
      formState.emailQueryDeliveryMethod === SYMBOLS.EMAIL_CHANNEL_FIELDS.ATTACH_OUTPUT
    ),
    channel.passThrough = (
      formState.emailQueryDeliveryMethod === SYMBOLS.EMAIL_CHANNEL_FIELDS.PASS_THROUGH
    ),
    channel.subject = formState.emailSubject
    channel.to = formState.emailTo ? formState.emailTo.replaceAll(/\s*\n+\s*/ug,',') : ''
    channel.cc = formState.emailCc ? formState.emailCc.replaceAll(/\s*\n+\s*/ug,',') : ''
    channel.emailTemplate = formState.emailTemplate || ''
  } else if (formState.type === SYMBOLS.CHANNEL_TYPES.SLACK) {
    channel.type = SYMBOLS.CHANNEL_TYPES.SLACK
    channel.webhookUrl = formState.slackWebhookUrl
  }

  if (selectedChannel >= 0) {
    channels[selectedChannel] = channel
  } else {
    channels.push(channel)
  }

  return {
    parentFormState: formState.parentFormState.parentFormState,
    ...formState.parentFormState,
    channels,
    dirty: formState.dirty,
  }
}

function EditChannelScreen({ selectedChannel }) {
  const {
      formState,
      updateFormState,
      validateFormState,
    } = useContext(FormContext),
    { validations } = formState,
    { navigate } = useContext(RouteDispatchContext),
    navigateToEditPublishConfig = useCallback(() => {
      navigate(
        ROUTES.EDIT_PUBLISH_CONFIG,
        { formState: channelFromFormState(formState, selectedChannel) }
      )
    }, [navigate, formState, selectedChannel]),
    handleChangeType = useCallback((_, v) => {
      updateFormState({ type: v })
    }, [updateFormState]),
    handleChangeEmailSubject = useCallback(e => {
      updateFormState({ emailSubject: e.target.value })
    }, [formState] ),
    handleChangeEmailFormat = useCallback((_, v) => {
      updateFormState({ emailFormat: v })
    }, [formState] ),
    handleChangeEmailQueryDeliveryMethod = useCallback((_, v) => {
      updateFormState({ emailQueryDeliveryMethod: v })
    }, [formState] ),
    handleChangeEmailTo = useCallback(e => {
      updateFormState({ emailTo: e.target.value })
    }, [formState] ),
    handleChangeEmailCc = useCallback(e => {
      updateFormState({ emailCc: e.target.value })
    }, [formState]),
    handleChangeEmailTemplate = useCallback(e => {
      updateFormState({ emailTemplate: e.target.value })
    }, [formState]),
    handleChangeSlackWebhookUrl = useCallback(e => {
      updateFormState({ slackWebhookUrl: e.target.value })
    }, [formState]),
    handleSubmit = useCallback(() => {
      validateFormState(navigateToEditPublishConfig)
    }),
    handleCancel = useCallback(() => {
      if (formState.dirty) {
        if (!confirm(UI_CONTENT.EDIT_CHANNEL_SCREEN.CANCEL_PROMPT)) {
          return
        }
      }

      navigate(ROUTES.EDIT_PUBLISH_CONFIG, {
        parentFormState: formState.parentFormState.parentFormState,
        ...formState.parentFormState,
      })
    }, [navigate, formState])

  return (
    <div className="edit-channel-screen">
      <Layout>
        <LayoutItem>
          <Card>
            <CardHeader title={UI_CONTENT.EDIT_CHANNEL_SCREEN.HEADING} />
            <CardBody>
              <Form
                className="edit-channel-form"
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
                  {UI_CONTENT.EDIT_CHANNEL_FORM.HEADING}
                </HeadingText>

                <Validation name="type" validation={channelTypeIsValid}>
                  <Select
                    label={UI_CONTENT.EDIT_CHANNEL_FORM.FIELD_LABEL_CHANNEL_TYPE}
                    onChange={handleChangeType}
                    value={formState.type}
                    invalid={validations?.type}
                  >
                    <SelectItem value={SYMBOLS.CHANNEL_TYPES.EMAIL}>
                      {UI_CONTENT.EDIT_CHANNEL_FORM.CHANNEL_TYPE_LABEL_EMAIL}
                    </SelectItem>
                    {/*
                    <SelectItem value={SYMBOLS.CHANNEL_TYPES.SLACK}>
                      {UI_CONTENT.EDIT_CHANNEL_FORM.CHANNEL_TYPE_LABEL_SLACK}
                    </SelectItem>
                    */}
                  </Select>
                </Validation>

                {
                  formState.type === SYMBOLS.CHANNEL_TYPES.EMAIL && (
                    <EmailChannelForm
                      onChangeSubject={handleChangeEmailSubject}
                      onChangeFormat={handleChangeEmailFormat}
                      onChangeQueryDeliveryMethod={handleChangeEmailQueryDeliveryMethod}
                      onChangeTo={handleChangeEmailTo}
                      onChangeCc={handleChangeEmailCc}
                      onChangeTemplate={handleChangeEmailTemplate}
                    />
                  )
                }

                {
                  formState.type === SYMBOLS.CHANNEL_TYPES.SLACK && (
                    <SlackChannelForm
                      onChangeWebhookUrl={handleChangeSlackWebhookUrl}
                    />
                  )
                }

                <Stack
                  spacingType={[
                    Stack.SPACING_TYPE.LARGE,
                    Stack.SPACING_TYPE.NONE,
                  ]}
                >
                  <StackItem>
                    <Button
                      onClick={handleSubmit}
                      type={Button.TYPE.PRIMARY}
                      spacingType={[
                        Button.SPACING_TYPE.NONE,
                        Button.SPACING_TYPE.SMALL,
                        Button.SPACING_TYPE.NONE,
                        Button.SPACING_TYPE.NONE,
                      ]}
                    >
                      {UI_CONTENT.GLOBAL.ACTION_LABEL_OK}
                    </Button>
                    <Button
                      onClick={handleCancel}
                      type={Button.TYPE.PLAIN}
                      spacingType={[
                        Button.SPACING_TYPE.NONE,
                        Button.SPACING_TYPE.SMALL,
                        Button.SPACING_TYPE.NONE,
                        Button.SPACING_TYPE.NONE,
                      ]}
                    >
                      {UI_CONTENT.GLOBAL.ACTION_LABEL_CANCEL}
                    </Button>
                  </StackItem>
                </Stack>
              </Form>
            </CardBody>
          </Card>
        </LayoutItem>
      </Layout>
    </div>
  )
}

export default function EditChannelScreenWrapper(props) {
  const {
      params: {
        formState,
        selectedChannel,
      }
    } = useContext(RouteContext),
    initFormState = useCallback(() => (
        formStateFromChannel(formState, selectedChannel)
      ),
      [formState, selectedChannel]
    )

  return withFormContext(
    <EditChannelScreen
      {...props}
      selectedChannel={selectedChannel}
    />,
    initFormState,
  )
}
