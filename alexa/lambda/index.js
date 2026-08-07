"use strict";

const Alexa = require("ask-sdk-core");
const { askWinston, toSsmlSafe } = require("./winston");
const winstonDisplay = require("./apl/winston-display.json");

const APL_TOKEN = "winstonDisplay";

function supportsApl(handlerInput) {
  const interfaces =
    Alexa.getSupportedInterfaces(handlerInput.requestEnvelope) || {};
  return Boolean(interfaces["Alexa.Presentation.APL"]);
}

function addDisplay(handlerInput, responseBuilder, { userQuery, responseText }) {
  if (!supportsApl(handlerInput)) {
    return responseBuilder;
  }
  const dateLine = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
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
          dateLine,
        },
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
  handle(handlerInput) {
    const speech =
      "Winston here. What do you need, Howard? " +
      "Ask me about your day, your pipeline, or anything else.";
    return addDisplay(handlerInput, handlerInput.responseBuilder, {
      userQuery: "",
      responseText: "Winston here. What do you need, Howard?",
    })
      .speak(speech)
      .reprompt("Still here. What do you need?")
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
      "I'm Winston, your executive assistant. Start a question with ask or " +
      "tell me. For example: ask what should I focus on today.";
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
    AskWinstonIntentHandler,
    HelpIntentHandler,
    FallbackIntentHandler,
    StopHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
