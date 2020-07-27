import { debug, getInput, setFailed } from "@actions/core";
import { context } from "@actions/github";
import { WebhookPayloadPullRequest } from "@octokit/webhooks";

import { backport } from "./backport";
import { xorHexStrings } from "./xor";

const run = async () => {
  try {
    const token = getInput("github_token", { required: true });
    const botUsername = getInput("bot_username", { required: true });
    const encryptedBotToken = getInput("bot_token", { required: true });
    const botTokenKey = getInput("bot_token_key", { required: false });

    let botToken;
    // If no botTokenKey was provided then the provided bot_token value does not need "decrypting"
    if (botTokenKey === '') {
      botToken = encryptedBotToken;
    } else {
      botToken = xorHexStrings(encryptedBotToken, botTokenKey);
    }

    debug(JSON.stringify(context, null, 2));
    await backport({
      botToken,
      botUsername,
      payload: context.payload as WebhookPayloadPullRequest,
      token,
    });
  } catch (error) {
    setFailed(error.message);
  }
};

run();
