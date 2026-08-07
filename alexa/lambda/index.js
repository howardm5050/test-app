"use strict";

const Alexa = require("ask-sdk-core");
const { askWinston, toSsmlSafe } = require("./winston");
const { loadDashboard, dashboardSpeech } = require("./dashboard");
const winstonDisplay = require("./apl/winston-display.json");
const controlCenter = require("./apl/winston-control-center.json");

const APL_TOKEN = "winstonDisplay";

function dateLine() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function supportsApl(handlerInput) {
  const interfaces =
    Alexa.getSupportedInterfaces(handlerInput.requestEnvelope) || {};
  return Boolean(interfaces["Alexa.Presentation.APL"]);
}

function addDisplay(handlerInput, responseBuilder, { userQuery, responseText }) {
  if (!supportsApl(handlerInput)) {
    return responseBuilder;
  }
  return responseBuilder.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    token: APL_TOKEN,
    document: winstonDisplay,
    datasources: {
      winston: {
        type: "object",
        properties: {
          userQuery: userQuery || "",
          responseText: responseText || "",
          dateLine: dateLine(),
        },
      },
    },
  });
}

function addControlCenter(handlerInput, responseBuilder, data, source) {
  if (!supportsApl(handlerInput)) {
    return responseBuilder;
  }
  const footerLine =
    source === "live"
      ? `Updated ${data.updatedAt || "recently"}  ·  "ask ..." to talk to Winston`
      : source === "stale"
        ? `Feed unreachable — showing last known state  ·  "ask ..." to talk to Winston`
        : `Sample data — set WINSTON_DASHBOARD_URL for a live feed  ·  "ask ..." to talk to Winston`;
  return responseBuilder.addDirective({
    type: "Alexa.Presentation.APL.RenderDocument",
    token: APL_TOKEN,
    document: controlCenter,
    datasources: {
      winston: {
        focus: data.focus || "",
        buckets: data.buckets || [],
        overdue: data.overdue || [],
        pipeline: data.pipeline || [],
        cadence: {
          touchesThisWeek: (data.cadence && data.cadence.touchesThisWeek) || 0,
          lastLinkedIn: (data.cadence && data.cadence.lastLinkedIn) || "—",
          lastEmailPhone: (data.cadence && data.cadence.lastEmailPhone) || "—",
          lastPipelineReview:
            (data.cadence && data.cadence.lastPipelineReview) || "—",
        },
        dateLine: dateLine(),
        footerLine,
      },
    },
  });
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest"
    );
  },
  async handle(handlerInput) {
    const { data, source } = await loadDashboard();
    const speech =
      "Winston here. " + dashboardSpeech(data, source) + " What do you need?";
    return addControlCenter(handlerInput, handlerInput.responseBuilder, data, source)
      .speak(toSsmlSafe(speech))
      .reprompt("Still here. What do you need?")
      .getResponse();
  },
};

const ShowDashboardIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "ShowDashboardIntent"
    );
  },
  async handle(handlerInput) {
    const { data, source } = await loadDashboard();
    return addControlCenter(handlerInput, handlerInput.responseBuilder, data, source)
      .speak(toSsmlSafe(dashboardSpeech(data, source)))
      .reprompt("Anything else?")
      .getResponse();
  },
};

const AskWinstonIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AskWinstonIntent"
    );
  },
  async handle(handlerInput) {
    const query = Alexa.getSlotValue(handlerInput.requestEnvelope, "query");
    if (!query) {
      return handlerInput.responseBuilder
        .speak("I didn't catch that, Howard. Say it again?")
        .reprompt("What do you need?")
        .getResponse();
    }

    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const { speech, history } = await askWinston(
      query,
      attributes.history || []
    );
    attributes.history = history;
    handlerInput.attributesManager.setSessionAttributes(attributes);

    return addDisplay(handlerInput, handlerInput.responseBuilder, {
      userQuery: query,
      responseText: speech,
    })
      .speak(toSsmlSafe(speech))
      .reprompt("Anything else?")
      .getResponse();
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.HelpIntent"
    );
  },
  handle(handlerInput) {
    const speech =
      "I'm Winston, your executive assistant. Say show my control center for " +
      "the board, or start a question with ask or tell me. For example: ask " +
      "what should I focus on today.";
    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt("What do you need?")
      .getResponse();
  },
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      Alexa.getIntentName(handlerInput.requestEnvelope) ===
        "AMAZON.FallbackIntent"
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(
        "Didn't catch that one. Start with ask or tell me, like: ask how " +
          "should I structure my morning."
      )
      .reprompt("What do you need?")
      .getResponse();
  },
};

const StopHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest" &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) ===
        "AMAZON.StopIntent" ||
        Alexa.getIntentName(handlerInput.requestEnvelope) ===
          "AMAZON.CancelIntent" ||
        Alexa.getIntentName(handlerInput.requestEnvelope) ===
          "AMAZON.NavigateHomeIntent")
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak("Winston out.").getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) ===
      "SessionEndedRequest"
    );
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error("Winston skill error:", error);
    return handlerInput.responseBuilder
      .speak(
        "I hit a snag reaching my brain, Howard. Give me a second and try again."
      )
      .reprompt("Try that again?")
      .getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    ShowDashboardIntentHandler,
    AskWinstonIntentHandler,
    HelpIntentHandler,
    FallbackIntentHandler,
    StopHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
