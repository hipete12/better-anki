import type { DeckConfig, Notetype, CollectionConfig } from "./types";
import { FSRS6_DEFAULT_PARAMS } from "./sched/fsrs";

const BASIC_CSS = `.card {
    font-family: arial;
    font-size: 20px;
    line-height: 1.5;
    text-align: center;
    color: black;
    background-color: white;
}
`;

const CLOZE_CSS =
  BASIC_CSS +
  `
.cloze {
    font-weight: bold;
    color: blue;
}
.nightMode .cloze {
    color: lightblue;
}
`;

const IO_CSS = `${BASIC_CSS}
#image-occlusion-container { position: relative; display: inline-block; max-width: 100%; }
#image-occlusion-container img { max-width: 100%; display: block; }
`;

type StockDef = Omit<Notetype, "id" | "mtime">;

function nt(name: string, kind: 0 | 1, fields: string[], templates: [string, string, string][], css: string): StockDef {
  return {
    name,
    kind,
    css,
    sortIdx: 0,
    fields: fields.map((f, i) => ({ name: f, ord: i, font: "Arial", size: 20 })),
    templates: templates.map(([n, q, a], i) => ({ name: n, ord: i, qfmt: q, afmt: a })),
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
  };
}

const BACK = "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}";

export const STOCK_NOTETYPES: Record<string, StockDef> = {
  basic: nt("Basic", 0, ["Front", "Back"], [["Card 1", "{{Front}}", BACK]], BASIC_CSS),
  basicReversed: nt(
    "Basic (and reversed card)",
    0,
    ["Front", "Back"],
    [
      ["Card 1", "{{Front}}", BACK],
      ["Card 2", "{{Back}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}"],
    ],
    BASIC_CSS,
  ),
  basicOptionalReversed: nt(
    "Basic (optional reversed card)",
    0,
    ["Front", "Back", "Add Reverse"],
    [
      ["Card 1", "{{Front}}", BACK],
      ["Card 2", "{{#Add Reverse}}{{Back}}{{/Add Reverse}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}"],
    ],
    BASIC_CSS,
  ),
  basicTyping: nt(
    "Basic (type in the answer)",
    0,
    ["Front", "Back"],
    [["Card 1", "{{Front}}\n\n{{type:Back}}", "{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}"]],
    BASIC_CSS,
  ),
  cloze: nt(
    "Cloze",
    1,
    ["Text", "Back Extra"],
    [["Cloze", "{{cloze:Text}}", "{{cloze:Text}}<br>\n{{Back Extra}}"]],
    CLOZE_CSS,
  ),
  imageOcclusion: nt(
    "Image Occlusion",
    1,
    ["Occlusion", "Image", "Header", "Back Extra", "Comments"],
    [
      [
        "Image Occlusion",
        "{{#Header}}<div>{{Header}}</div>{{/Header}}\n<div style=\"display: none\">{{cloze:Occlusion}}</div>\n<div id=\"image-occlusion-container\">\n    {{Image}}\n    <canvas id=\"image-occlusion-canvas\"></canvas>\n</div>\n<script>try { anki.imageOcclusion.setup(); } catch (exc) { document.getElementById(\"image-occlusion-container\").insertAdjacentHTML(\"beforeend\", `<div style=\"color:red\">${exc}</div>`); }</script>",
        "{{#Header}}<div>{{Header}}</div>{{/Header}}\n<div style=\"display: none\">{{cloze:Occlusion}}</div>\n<div id=\"image-occlusion-container\">\n    {{Image}}\n    <canvas id=\"image-occlusion-canvas\"></canvas>\n</div>\n<script>try { anki.imageOcclusion.setup(); } catch (exc) { document.getElementById(\"image-occlusion-container\").insertAdjacentHTML(\"beforeend\", `<div style=\"color:red\">${exc}</div>`); }</script>\n<div><button id=\"toggle\">Toggle Masks</button></div>\n{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}",
      ],
    ],
    IO_CSS,
  ),
};

export function defaultDeckConfig(id: number, name: string): DeckConfig {
  return {
    id,
    name,
    mtime: 0,
    newPerDay: 20,
    reviewsPerDay: 200,
    newIgnoreReviewLimit: false,
    learnSteps: [1, 10],
    graduatingIvl: 1,
    easyIvl: 4,
    initialEase: 2.5,
    newInsertOrder: 0,
    newGatherPriority: 0,
    newSortOrder: 0,
    newMix: 0,
    interdayLearningMix: 0,
    reviewOrder: 0,
    relearnSteps: [10],
    minLapseIvl: 1,
    lapseMult: 0,
    leechThreshold: 8,
    leechAction: 1,
    maxIvl: 36500,
    easyMult: 1.3,
    hardMult: 1.2,
    ivlMult: 1.0,
    buryNew: false,
    buryReviews: false,
    buryInterday: false,
    showTimer: false,
    capAnswerSecs: 60,
    disableAutoplay: false,
    skipQuestionWhenReplayingAnswer: false,
    autoAdvanceQuestionSecs: 0,
    autoAdvanceAnswerSecs: 0,
    autoAdvanceAnswerAction: 0,
    desiredRetention: 0.9,
    fsrsParams: [...FSRS6_DEFAULT_PARAMS],
    historicalRetention: 0.9,
    ignoreRevlogsBefore: "",
    easyDays: [1, 1, 1, 1, 1, 1, 1],
  };
}

export function defaultCollectionConfig(): CollectionConfig {
  return {
    rolloverHour: 4,
    learnAheadMins: 20,
    timeboxMins: 0,
    fsrs: true,
    loadBalancer: true,
    currentDeckId: 1,
    addingDefaultsToCurrentDeck: true,
    lastNotetypeId: 0,
    lastDeckId: 1,
    newSpread: 0,
    dayLearnFirst: false,
    collectionCreated: Math.floor(Date.now() / 1000),
    showIntervalsOnButtons: true,
    showRemainingCount: true,
    backupKeep: 30,
  };
}
