// Sensitivity profiles.
//
// Every detection threshold used to be a numeric literal buried in content.js and
// background.js, which left a user who found CleanTab too twitchy (or too loose) with
// exactly one lever: turn it off. That is the most likely reason someone uninstalls.
// Nothing in the detection path should compare against a literal any more.

const SENSITIVITY_PROFILES = {
  strict: {
    label: "Strict",
    blurb: "Blocks on weaker signals. More false positives.",
    urlScore: 3,
    titleScore: 4,
    textScore: 2,
    envScore: 4,
    unsafeProb: 0.45,
    safeProb: 0.9,
    dwell: true,
  },
  balanced: {
    label: "Balanced",
    blurb: "The default. Blocks clear signals, lets ambiguity through.",
    urlScore: 5,
    titleScore: 6,
    textScore: 3,
    envScore: 5,
    unsafeProb: 0.6,
    safeProb: 0.85,
    dwell: true,
  },
  lenient: {
    label: "Lenient",
    blurb: "Only unmistakable content. Image scanning off.",
    urlScore: 8,
    titleScore: 9,
    textScore: 5,
    envScore: 7,
    unsafeProb: 0.75,
    safeProb: 0.8,
    dwell: false,
  },
};

const DEFAULT_SENSITIVITY = "balanced";

function getProfile(name) {
  return SENSITIVITY_PROFILES[name] || SENSITIVITY_PROFILES[DEFAULT_SENSITIVITY];
}
