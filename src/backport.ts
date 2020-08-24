import { error as logError, group, warning, info, debug, setFailed } from "@actions/core";
import { exec } from "@actions/exec";
import { context, getOctokit } from "@actions/github";
import { GitHub } from "@actions/github/lib/utils";

import { WebhookPayloadPullRequest } from "@octokit/webhooks";
import pMap from 'p-map';
import { promises as fs } from 'fs';
import * as path from 'path';

const labelRegExp = /^backport ([^ ]+)(?: ([^ ]+))?$/;

const getLabelNames = ({
  action,
  label,
  labels,
}: {
  action: WebhookPayloadPullRequest["action"];
  label: { name: string };
  labels: WebhookPayloadPullRequest["pull_request"]["labels"];
}): string[] => {
  switch (action) {
    case "closed":
      return labels.map(({ name }) => name);
    case "labeled":
      return [label.name];
    default:
      return [];
  }
};

const getBackportBaseToHead = ({
  action,
  label,
  labels,
  pullRequestNumber,
}: {
  action: WebhookPayloadPullRequest["action"];
  label: { name: string };
  labels: WebhookPayloadPullRequest["pull_request"]["labels"];
  pullRequestNumber: number;
}): { [base: string]: string } =>
  getLabelNames({ action, label, labels }).reduce((baseToHead, labelName) => {
    const matches = labelRegExp.exec(labelName);
    if (matches === null) {
      return baseToHead;
    }

    const [, base, head = `backport-${pullRequestNumber}-to-${base}`] = matches;
    return { ...baseToHead, [base]: head };
  }, {});

const getCommits = async (github: InstanceType<typeof GitHub>, owner: string, repo: string, pullRequestNumber: number) => {
  const commits = await github.pulls.listCommits({
    mediaType: {
      format: 'patch'
    },
    owner,
    pull_number: pullRequestNumber,
    repo,
  });

  return commits.data
    .filter((commit) => !/^Merge branch '\S+' into \S+/.test(commit.commit.message))
    .map((commit) => commit.url);
}

const backportOnce = async ({
  base,
  body,
  botUsername,
  commits,
  github,
  head,
  owner,
  repo,
  title,
}: {
  base: string;
  body: string;
  botUsername: string;
  commits: string[]
  github: InstanceType<typeof GitHub>;
  head: string;
  owner: string;
  repo: string;
  title: string;
}) => {
  const git = async (...args: string[]) => {
    await exec("git", args, { cwd: repo });
  };

  const mapCommits = async (commitUrl: string) => {
    const { data } = await github.request(commitUrl, {
      mediaType: {
        format: 'patch'
      }
    });
    return data;
  };

  const patches = await pMap(commits, mapCommits);

  try {
    await git("fetch", "origin");
    await git("checkout", `origin/${base}`);
    await git("checkout", "-b", head);

    const patchFile = path.join(__dirname, `${repo}.patch`);
    for (const patch of patches) {
      await fs.writeFile(patchFile, patch, 'utf8');
      await git("am", "-3", "--ignore-whitespace", patchFile);
      await fs.unlink(patchFile);
    }

    await git("push", "botrepo", head);
    await github.pulls.create({
      base,
      body,
      head: `${botUsername}:${head}`,
      maintainer_can_modify: true,
      owner,
      repo,
      title,
    });
  } catch (error) {
    warning(error);
    await git("am", "--abort");
    throw error;
  }
};

const getFailedBackportCommentBody = async ({
  base,
  commits,
  errorMessage,
  github,
  head
}: {
  base: string;
  commitToBackport: string;
  commits: string[];
  errorMessage: string;
  github: InstanceType<typeof GitHub>;
  head: string;
}) => {

  const apiToPatchUrl = async (commitUrl: string) => {
    const { data } = await github.request(commitUrl);

    return `curl -s ${data.html_url}.patch | git am -3 --ignore-whitespace`;
  }

  const commitCommands = await pMap(commits, apiToPatchUrl);

  const runUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`

  return [
    `The backport to \`${base}\` failed:`,
    "```",
    errorMessage,
    "```",
    `Check [the run](${runUrl}) for full details`,
    "To backport manually, run these commands in your terminal:",
    "```bash",
    "# Fetch latest updates from GitHub",
    "git fetch",
    "# Check out the target branch",
    `git checkout ${base}`,
    "# Make sure it's up to date",
    "git pull",
    "# Check out your branch",
    `git checkout -b ${head}`,
    "# Apply the commits from the PR",
    ...commitCommands,
    "# Push it to GitHub",
    `git push --set-upstream origin ${head}`,
    "```",
    `Then, create a pull request where the \`base\` branch is \`${base}\` and the \`compare\`/\`head\` branch is \`${head}\`.`,
  ].join("\n");
};

const backport = async ({
  botToken,
  botUsername,
  payload: {
    action,
    // The payload has a label property when the action is "labeled".
    // @ts-ignore
    label,
    pull_request: {
      labels,
      merge_commit_sha: mergeCommitSha,
      merged,
      number: pullRequestNumber,
      title: originalTitle
    },
    repository: {
      name: repo,
      owner: { login: owner },
    },
  }
}: {
  botToken: string;
  botUsername: string;
  payload: WebhookPayloadPullRequest;
  token: string;
}) => {

  if (!merged) {
    return;
  }

  const backportBaseToHead = getBackportBaseToHead({
    action,
    label,
    labels,
    pullRequestNumber,
  });

  if (Object.keys(backportBaseToHead).length === 0) {
    return;
  }

  const githubUsingBotToken = getOctokit(botToken);

  // The merge commit SHA is actually not null.
  const commitToBackport = String(mergeCommitSha);
  info(`Backporting ${commitToBackport} from #${pullRequestNumber}`);

  const git = async (...args: string[]) => {
    await exec("git", args, { cwd: repo });
  };

  await exec("git", [
    "clone",
    `https://x-access-token:${botToken}@github.com/${owner}/${repo}.git`,
  ]);

  await git(
    "remote",
    "add",
    "botrepo",
    `https://x-access-token:${botToken}@github.com/${botUsername}/${repo}.git`,
  );

  await exec("git", [
    "config",
    "--global",
    "user.email",
    "github-actions[bot]@users.noreply.github.com",
  ]);
  await exec("git", ["config", "--global", "user.name", "github-actions[bot]"]);

  const commits = await getCommits(githubUsingBotToken, owner, repo, pullRequestNumber);

  for (const [base, head] of Object.entries(backportBaseToHead)) {
    const body = `Backport ${commitToBackport} from #${pullRequestNumber}`;
    const title = `[Backport ${base}] ${originalTitle}`;
    await group(`Backporting to ${base} on ${head}`, async () => {
      try {
        await backportOnce({
          base,
          body,
          botUsername,
          commits,
          github: githubUsingBotToken,
          head,
          owner,
          repo,
          title
        });
      } catch (error) {
        const errorMessage = error.message;
        logError(`Backport failed: ${errorMessage}`);
        debug(error);
        await githubUsingBotToken.issues.createComment({
          body: await getFailedBackportCommentBody({
            base,
            commits,
            commitToBackport,
            errorMessage,
            github: githubUsingBotToken,
            head,
          }),
          issue_number: pullRequestNumber,
          owner,
          repo,
        });
        setFailed(`1 or more backports failed with ${errorMessage}`);
      }
    });
  }
};

export { backport };
