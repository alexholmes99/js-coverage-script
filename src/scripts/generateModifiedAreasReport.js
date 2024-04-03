/* eslint no-useless-concat: "off" */
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const madge = require("madge");

const octokit = new Octokit({
  auth: process.env.GITHUB_PAT,
});

const AREA_DICTIONARY = {
  administration: { label: "ADMINISTRATION", priority: 1 },
  lobby: { label: "LOBBY", priority: 1 },
  user: { label: "USER", priority: 1 },
  area: { label: "AREA", priority: 2 },
  container: { label: "AREA", priority: 3 },
};

async function updatePRDescription(affectedAreas, prValues) {
  const { owner, repo, pullNumber } = prValues;

  const targetedPR = await octokit.pulls.get({
    owner: owner,
    repo: repo,
    pull_number: pullNumber,
  });

  const regex = new RegExp(
    "(" +
      "<!-- JSChangesStart -->" +
      ")" +
      "([\\w\\s|\\/\\\\\\-\\:\\.]*)" +
      "(" +
      "<!-- JSChangesEnd -->" +
      ")",
    "gm"
  );

  const newBody = targetedPR.data.body.replace(regex, `$1\n${affectedAreas}$3`);

  await octokit.rest.pulls.update({
    owner: owner,
    repo: repo,
    pull_number: pullNumber,
    body: newBody,
  });
}

async function getModifiedFiles(prValues) {
  const { owner, repo, pullNumber } = prValues;

  const { data: files } = await octokit.rest.pulls.listFiles({
    owner: owner,
    repo: repo,
    pull_number: pullNumber,
  });

  return files
    .filter((file) => ["modified", "added"].includes(file.status))
    .map((f) => f.filename);
}

function humanReadableFilePaths(affectedAreas) {
  const areasList = [];

  affectedAreas.forEach((area) => {
    let parsedArea = [];

    Object.keys(AREA_DICTIONARY).forEach((areaDefinition) => {
      if (area.toLowerCase().includes(areaDefinition.toLowerCase())) {
        parsedArea.push(AREA_DICTIONARY[areaDefinition]);
      }
    });

    parsedArea = parsedArea
      .sort((a, b) => a.priority - b.priority)
      .map((areaObject) => areaObject.label)
      .join(" ");

    if (parsedArea.length > 0) {
      areasList.push(parsedArea);
    } else {
      areasList.push(area);
    }
  });

  const readableAreas = [...new Set(areasList)];
  console.dir({ affectedAreas: readableAreas });

  return readableAreas;
}

async function generateModifiedAreasReport(prValues) {
  // Fetch modified files from PR
  const modifiedFiles = await getModifiedFiles(prValues);
  console.dir({ count: modifiedFiles.length, modifiedFiles: modifiedFiles });

  madge("./").then((res) => {
    let topLevelDependencies = [];
    // Fetch top level nodes from dependency tree
    function modifiedFilePaths(files) {
      let iterationDependencies = [];

      files.forEach((file) => {
        if (file.includes("index")) {
          topLevelDependencies.push(file);
        }

        const fileDependencies = res.depends(file);
        iterationDependencies = iterationDependencies.concat(fileDependencies);
      });

      iterationDependencies = iterationDependencies.filter(
        (file) => !file.includes(".test") && !file.includes("scripts")
      );

      if (iterationDependencies.length === 0) {
        topLevelDependencies = topLevelDependencies.concat(files);
      } else {
        modifiedFilePaths(iterationDependencies);
      }

      return topLevelDependencies;
    }

    // Parse values as human readable areas
    const humanReadableAreas = humanReadableFilePaths(
      modifiedFilePaths(modifiedFiles)
    );

    const modifiedAreas = {
      modified_areas: humanReadableAreas,
    };

    // Cap modified areas list at 15 lines in PR body
    let prBody = humanReadableAreas;

    if (prBody.length >= 15) {
      prBody = prBody.slice(0, 14);
      prBody.unshift("View full list in modified_areas artifact");
    }

    console.dir({ prBody });

    // Update PR Body with modified areas
    updatePRDescription(prBody.join("\n"), prValues);
    // Write modified areas to file
    fs.writeFileSync(
      "./src/test_results/modified_areas.json",
      JSON.stringify(modifiedAreas, null, 2)
    );
  });
}

module.exports = (prValues) => {
  return generateModifiedAreasReport(prValues);
};
