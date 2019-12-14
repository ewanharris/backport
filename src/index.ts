import { debug, getInput, setFailed } from "@actions/core";
import { context } from "@actions/github";
import { WebhookPayloadPullRequest } from "@octokit/webhooks";

import { backport } from "./backport";

const run = async () => {
  try {
    const token = getInput("github_token", { required: true });
    const botUsername = getInput("bot_username", { required: true });
    const botToken = getInput("bot_token", { required: true });
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
