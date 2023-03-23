/* eslint-disable */
const fs = require("fs");
const path = require("path");

const Robots = require("../backend/lib/robots");
const Configuration = require("../backend/lib/Configuration");
const ValetudoEventStore = require("congatudo-backend/lib/ValetudoEventStore");

function generateAnchor(str) {
  return str.replace(/[^0-9a-z-A-Z]/g, "").toLowerCase();
}

function generateCapabilityLink(capability) {
  return (
    "[" +
    capability +
    "](https://valetudo.cloud/pages/general/capabilities-overview.html#" +
    capability +
    ")"
  );
}

function generateTable(models, tableData) {
  let ret = "## Overview<a id='Overview'></a>\n\nCapability | ";
  ret += models
    .map((m) => {
      return "<a href='#" + m[1] + "'>" + m[0] + "</a>";
    })
    .join(" | ");
  ret += "\n----";
  models.forEach(() => {
    ret += " | ----";
  });
  ret += "\n";
  Object.keys(tableData)
    .sort()
    .forEach((capability) => {
      ret += generateCapabilityLink(capability);
      models.forEach((m) => {
        ret += " | ";
        if (tableData[capability].indexOf(m[0]) !== -1) {
          ret += '<span style="color:green;">Yes</span>';
        } else {
          ret += '<span style="color:red;">No</span>';
        }
      });
      ret += "\n";
    });

  return ret;
}

process.on("uncaughtException", function (err) {
  if (err.errno === "EADDRINUSE") {
    //lol
  } else {
    console.log(err);
    process.exit(1);
  }
});

const VALETUDO_SUPPORT_GRADES = {
  GREAT: "great",
  GOOD: "good",
  OKAY: "okay",
  MEH: "meh",
  BAD: "bad",
};

const DEVELOPER_SUPPORT_GRADES = {
  YES: "yes",
  BEST_EFFORT: "best effort",
  SOME_EFFORT: "some effort",
  NONE: "none",
};

const BUY_GRADES = {
  GET_IT_RIGHT_NOW: "get it right now!",
  OKAY: "Can't go wrong with this model",
  OKAY_ISH:
    "This model is okay but has some issues that keep it from being fully recommendable",
  NOT_OKAY:
    "This model has issues and therefore isn't recommended (see comment)",
  OUTDATED_OKAY: "outdated but still okay-ish",
  OUTDATED_NOT_OKAY: "outdated. not recommended (anymore)",
};

const VALETUDO_ARCHITECTURES = {
  ARM: "armv7",
  ARM_LOWMEM: "armv7-lowmem",
  AARCH64: "aarch64",
};

const ModelDescriptions = {
    "Dreame": {
        "1C": {
            valetudoSupport: VALETUDO_SUPPORT_GRADES.OKAY,
            developerSupport: DEVELOPER_SUPPORT_GRADES.BEST_EFFORT,
            testedWorking: true,
            recommended: BUY_GRADES.OKAY_ISH,
            comment: "vSLAM and a small battery, though there are persistent maps and everything seems to work",
            architecture: VALETUDO_ARCHITECTURES.ARM,
        }
    },
    "Cecotec": {
        "Conga": {
              valetudoSupport: VALETUDO_SUPPORT_GRADES.GOOD,
              developerSupport: DEVELOPER_SUPPORT_GRADES.BEST_EFFORT,
              testedWorking: true,
              recommended: BUY_GRADES.OKAY,
              comment: "This adaptation only supports Conga models that works with Conga 3000 retail app",
              architecture: VALETUDO_ARCHITECTURES.ARM,
        }
    }
};

function getModelDescription(vendor, model) {
  const description = ModelDescriptions[vendor]?.[model];

  if (!description) {
    throw new Error(`Missing description for ${vendor} ${model}`);
  }

  return [
    `#### Valetudo Support\n\n${description.valetudoSupport}\n\n`,
    `#### Developer Support\n\n${description.developerSupport}\n\n`,
    "#### Tested Working\n\n" +
      (description.testedWorking ? "✔" : "❌") +
      "\n\n",
    `#### Recommended\n\n${description.recommended}\n\n`,
    `#### Recommended Valetudo binary to use\n\n${description.architecture}\n\n`,
    `#### Comment\n\n${description.comment}\n\n`,
  ];
}

/**
 * We're hiding implementations that aren't ready to be used by people casually checking the docs
 * They might never be ready to be used and just exist as a test etc.
 *
 * Don't get your hopes up just because there's an implementation
 *
 * @type {string[]}
 */
const HIDDEN_IMPLEMENTATIONS = [
    "ViomiV7ValetudoRobot",
    "RoborockM1SValetudoRobot",
    "RoborockS6MaxVValetudoRobot",
    "RoborockS7ValetudoRobot",
    "DreameP2149ValetudoRobot",
    "DreameL10SUltraValetudoRobot",
];

const vendors = {};

Object.values(Robots).forEach((robotClass) => {
  if (HIDDEN_IMPLEMENTATIONS.includes(robotClass.name)) {
    return;
  }

  const config = new Configuration();
  config.set("embedded", false);
  const eventStore = new ValetudoEventStore();

  try {
    const instance = new robotClass({
      config: config,
      valetudoEventStore: eventStore,
    });

    vendors[instance.getManufacturer()] = vendors[instance.getManufacturer()]
      ? vendors[instance.getManufacturer()]
      : {};

    vendors[instance.getManufacturer()][instance.constructor.name] = {
      vendorName: instance.getManufacturer(),
      modelName: instance.getModelName(),
      capabilities: Object.keys(instance.capabilities).sort(),
    };
  } catch (e) {
    console.error(e);
  }
});

const header = `---
title: Supported Robots
category: General
order: 9
---

# Supported Robots

This page features an autogenerated overview of all robots supported by Valetudo including their supported capabilities.<br/>
To find out what those do, check out the [capabilities overview](https://valetudo.cloud/pages/general/capabilities-overview.html) section of the docs.

You also might want to take a look at the [Buying supported robots](https://valetudo.cloud/pages/general/buying-supported-robots.html) page.

This is just the autogenerated overview because it's hard to write documentation for everything and keep that up to date. <br/>
Keep in mind that rooting instructions will differ for each of these **or might not even be available at all**.
Just because the code would - in theory - support a Robot doesn't necessarily mean that you can simply buy it and put Valetudo on it.<br/>

To find out if you can install Valetudo on your robot, check out the [Rooting Instructions](https://valetudo.cloud/pages/general/rooting-instructions.html).
If you can't find it there, it's most likely not possible (yet?).
Another source is [https://dontvacuum.me/robotinfo/](https://dontvacuum.me/robotinfo/). Search for "Root method public?".
If it's listed as "no", then it's certainly not possible for you to run Valetudo on it.

There's also some more information regarding whether or not you should buy a specific robot below the table.

The recommended Valetudo binary architectures armv7, armv7-lowmem and aarch64 are also listed for every robot. Even though
armv7 binaries work on aarch64 robots, using the correct binary for your robot is recommended.

Again:<br/>
This is just an autogenerated overview based on the codebase at the time of generation.<br/>
Don't take this as "Everything listed here will be 100% available and work all the time".<br/>

`;

const ToC = ["## Table of Contents", "1. [Overview](#Overview)"];
const VendorSections = [];

const SummaryTable = {};
const RobotModels = [];

Object.keys(vendors)
  .filter((v) => v !== "Valetudo")
  .sort()
  .forEach((vendor, i) => {
    let vendorTocEntry = [
      i + 2 + ". [" + vendor + "](#" + generateAnchor(vendor) + ")",
    ];

    // noinspection JSMismatchedCollectionQueryUpdate
    let vendorSection = [
      "## " + vendor + '<a id="' + generateAnchor(vendor) + '"></a>',
      "",
    ];

    const vendorRobots = vendors[vendor];

    Object.keys(vendorRobots)
      .sort()
      .forEach((robotImplName, i) => {
        const robot = vendorRobots[robotImplName];
        const robotAnchor =
          generateAnchor(vendor) + "_" + generateAnchor(robot.modelName);

        RobotModels.push([robot.modelName, robotAnchor]);

        vendorTocEntry.push(
          "    " + (i + 1) + ". [" + robot.modelName + "](#" + robotAnchor + ")"
        );

        vendorSection.push(
          "### " + robot.modelName + '<a id="' + robotAnchor + '"></a>',
          "",
          getModelDescription(robot.vendorName, robot.modelName).join("\n\n"),
          "",
          "#### This model supports the following capabilities:"
        );

        robot.capabilities.forEach((capability) => {
          vendorSection.push("  - " + generateCapabilityLink(capability));
          if (!SummaryTable.hasOwnProperty(capability)) {
            SummaryTable[capability] = [robot.modelName];
          } else {
            SummaryTable[capability].push(robot.modelName);
          }
        });

        vendorSection.push("", "");
      });

    ToC.push(vendorTocEntry.join("\n"));
    VendorSections.push(vendorSection.join("\n"));
  });

const page = [
  header,
  ToC.join("\n"),
  "\n<br/>\n",
  generateTable(RobotModels, SummaryTable),
  "\n<br/>\n",
  VendorSections.join("\n"),
  "<br/><br/><br/><br/><br/>",
  "This page has been autogenerated.<br/>",
  "Autogeneration timestamp: " + new Date().toISOString(),
];

fs.writeFileSync(
  path.join(__dirname, "../docs/_pages/general/supported-robots.md"),
  page.join("\n") + "\n"
);
process.exit(0);
