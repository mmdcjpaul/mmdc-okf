// Search latency on the 20,000-note vault (plans/02-library.md, L4): p95 under 300 ms.
// Run through `pnpm scale:library`, which starts the app and passes BASE_URL and SESSION.
import http from "k6/http";
import { check } from "k6";

const WORDS = (
  "review payment ledger enrollment access refund invoice onboarding laptop password " +
  "schedule report approval deposit outage sync account policy request close"
).split(" ");

export const options = {
  scenarios: {
    search: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "10s", target: 10 },
        { duration: "30s", target: 20 },
        { duration: "5s", target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{kind:palette}": ["p(95)<300"],
    "http_req_duration{kind:page}": ["p(95)<300"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

function query() {
  const n = 1 + Math.floor(Math.random() * 3);
  const words = [];
  for (let i = 0; i < n; i++) words.push(WORDS[Math.floor(Math.random() * WORDS.length)]);
  // A typo now and then, as people make them.
  if (Math.random() < 0.2) words[0] = words[0].slice(0, -1);
  return encodeURIComponent(words.join(" "));
}

export default function () {
  const params = { headers: { cookie: `lore_session=${__ENV.SESSION}` } };
  const palette = http.get(`${__ENV.BASE_URL}/api/search?q=${query()}&limit=12`, {
    ...params,
    tags: { kind: "palette" },
  });
  check(palette, {
    "palette answers 200": (r) => r.status === 200,
    "palette returns hits": (r) => r.json("hits").length > 0,
  });
  const page = http.get(`${__ENV.BASE_URL}/search?q=${query()}`, {
    ...params,
    tags: { kind: "page" },
  });
  check(page, { "results page answers 200": (r) => r.status === 200 });
}
