import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Copy, Pencil, Trash2, Wand2, Save, Info } from "lucide-react";
import { api, type DeckConfig, type CollectionConfig } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Button, Card, Field, Input, Loading, Menu, Select, Switch, useDialogs, useToast, Badge } from "../components/ui";

const NEW_GATHER = [
  [0, "Deck"],
  [5, "Deck, then random notes"],
  [1, "Ascending position"],
  [2, "Descending position"],
  [3, "Random notes"],
  [4, "Random cards"],
];
const NEW_SORT = ["Card type, then order gathered", "Order gathered", "Card type, then random", "Random note, then card type", "Random"];
const MIX = ["Mix with reviews", "Show after reviews", "Show before reviews"];
const REVIEW_ORDER = [
  [0, "Due date, then random"],
  [1, "Due date, then deck"],
  [2, "Deck, then due date"],
  [3, "Ascending intervals"],
  [4, "Descending intervals"],
  [5, "Ascending ease"],
  [6, "Descending ease"],
  [7, "Ascending retrievability"],
  [11, "Descending retrievability"],
  [12, "Relative overdueness"],
  [8, "Random"],
  [9, "Order added"],
  [10, "Reverse order added"],
];
const AUTO_ANSWER = ["Bury card", "Answer Again", "Answer Good", "Answer Hard", "Show reminder"];

const stepsToText = (s: number[]) => s.map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${m}m`)).join(" ");
function textToSteps(t: string): number[] | null {
  const out: number[] = [];
  for (const part of t.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(part);
    if (!m) return null;
    const v = +m[1];
    out.push(m[2] === "s" ? v / 60 : m[2] === "h" ? v * 60 : m[2] === "d" ? v * 1440 : v);
  }
  return out;
}

export default function DeckOptions() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const deck = useApi(() => api.get<{ deck: { id: number; name: string; configId: number; newLimit?: number | null; reviewLimit?: number | null; desiredRetention?: number | null } }>(`/api/decks/${deckId}`), [deckId]);
  const presets = useApi(() => api.get<(DeckConfig & { useCount: number })[]>("/api/deck-configs"), []);
  const col = useApi(() => api.get<CollectionConfig>("/api/config"), []);
  const [confId, setConfId] = useState<number>(0);
  const [c, setC] = useState<DeckConfig | null>(null);
  const [learn, setLearn] = useState("");
  const [relearn, setRelearn] = useState("");
  const [params, setParams] = useState("");
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optResult, setOptResult] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState(false);
  const toast = useToast();
  const dialogs = useDialogs();

  useEffect(() => {
    if (deck.data && !confId) setConfId(deck.data.deck.configId);
  }, [deck.data, confId]);
  useEffect(() => {
    const p = presets.data?.find((x) => x.id === confId);
    if (p) {
      setC(p);
      setLearn(stepsToText(p.learnSteps));
      setRelearn(stepsToText(p.relearnSteps));
      setParams(p.fsrsParams.map((x) => +x.toFixed(4)).join(", "));
      setOptResult(null);
    }
  }, [confId, presets.data]);

  if (!deck.data || !presets.data || !c || !col.data) return <Loading />;
  const set = <K extends keyof DeckConfig>(k: K, v: DeckConfig[K]) => setC({ ...c, [k]: v });
  const fsrs = col.data.fsrs;

  const save = async () => {
    const ls = textToSteps(learn);
    const rs = textToSteps(relearn);
    if (!ls || !rs) return toast("Steps must look like: 1m 10m 1d", "error");
    const fp = params.split(/[\s,]+/).filter(Boolean).map(Number);
    if (![17, 19, 21].includes(fp.length) || fp.some((x) => !Number.isFinite(x))) return toast("FSRS parameters must be 17, 19 or 21 numbers", "error");
    setBusy(true);
    try {
      await api.put(`/api/deck-configs/${c.id}`, { ...c, learnSteps: ls, relearnSteps: rs, fsrsParams: fp, reschedule });
      if (deck.data!.deck.configId !== c.id) await api.patch(`/api/decks/${deckId}`, { configId: c.id });
      toast("Options saved", "success");
      navigate(-1);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const optimize = async () => {
    setOptimizing(true);
    try {
      const r = await api.post<{ params: number[]; logLoss: number; rmse: number; defaultLogLoss: number; defaultRmse: number; reviews: number; improved: boolean }>(`/api/deck-configs/${c.id}/optimize`);
      if (r.reviews < 100) setOptResult(`Only ${r.reviews} usable reviews; at least 100 are needed. Keeping current parameters.`);
      else {
        setParams(r.params.join(", "));
        setOptResult(r.improved ? `Optimized on ${r.reviews} reviews: log loss ${r.defaultLogLoss.toFixed(4)} → ${r.logLoss.toFixed(4)}, RMSE ${(r.defaultRmse * 100).toFixed(2)}% → ${(r.rmse * 100).toFixed(2)}%. Save to apply.` : `Default parameters already fit your ${r.reviews} reviews best.`);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setOptimizing(false);
    }
  };

  const num = (k: keyof DeckConfig, step = 1) => <Input type="number" step={step} value={c[k] as number} onChange={(e) => set(k, +e.target.value as never)} />;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-app mb-4">
        <ArrowLeft className="size-4" /> Back
      </button>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deck options</h1>
          <p className="text-sm text-muted">{deck.data.deck.name}</p>
        </div>
        <Button variant="primary" onClick={save} loading={busy}>
          <Save className="size-4" /> Save
        </Button>
      </div>

      <Card className="p-4 mb-4 flex flex-wrap items-end gap-2 sticky top-2 z-20 shadow-sm">
        <Field label="Preset" className="flex-1 min-w-48">
          <Select value={confId} onChange={(e) => setConfId(+e.target.value)}>
            {presets.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.useCount} deck{p.useCount === 1 ? "" : "s"})
              </option>
            ))}
          </Select>
        </Field>
        <Menu
          trigger={(t) => <Button onClick={t}>Manage</Button>}
          items={[
            {
              label: "Add preset",
              icon: <Plus />,
              onClick: async () => {
                const name = await dialogs.prompt({ title: "New preset", confirm: "Add" });
                if (name) {
                  const p = await api.post<DeckConfig>("/api/deck-configs", { name });
                  await presets.reload();
                  setConfId(p.id);
                }
              },
            },
            {
              label: "Clone preset",
              icon: <Copy />,
              onClick: async () => {
                const name = await dialogs.prompt({ title: "Clone preset", value: `${c.name} copy`, confirm: "Clone" });
                if (name) {
                  const p = await api.post<DeckConfig>("/api/deck-configs", { name, cloneFrom: c.id });
                  await presets.reload();
                  setConfId(p.id);
                }
              },
            },
            {
              label: "Rename preset",
              icon: <Pencil />,
              onClick: async () => {
                const name = await dialogs.prompt({ title: "Rename preset", value: c.name, confirm: "Rename" });
                if (name) set("name", name);
              },
            },
            {
              label: "Delete preset",
              icon: <Trash2 />,
              danger: true,
              disabled: c.id === 1,
              onClick: async () => {
                if (await dialogs.confirm({ title: `Delete preset "${c.name}"?`, body: "Decks using it will switch to the default preset.", danger: true, confirm: "Delete" })) {
                  await api.del(`/api/deck-configs/${c.id}`);
                  setConfId(1);
                  presets.reload();
                }
              },
            },
          ]}
        />
      </Card>

      <div className="space-y-4">
        <Section title="Daily limits">
          <Grid>
            <Field label="New cards/day">{num("newPerDay")}</Field>
            <Field label="Maximum reviews/day">{num("reviewsPerDay")}</Field>
          </Grid>
          <Switch checked={c.newIgnoreReviewLimit} onChange={(v) => set("newIgnoreReviewLimit", v)} label="New cards ignore review limit" />
        </Section>

        <Section title="New cards">
          <Grid>
            <Field label="Learning steps" hint="e.g. 1m 10m 1h 1d">
              <Input value={learn} onChange={(e) => setLearn(e.target.value)} className="font-mono" />
            </Field>
            {!fsrs && <Field label="Graduating interval (days)">{num("graduatingIvl")}</Field>}
            {!fsrs && <Field label="Easy interval (days)">{num("easyIvl")}</Field>}
            <Field label="Insertion order">
              <Select value={c.newInsertOrder} onChange={(e) => set("newInsertOrder", +e.target.value)}>
                <option value={0}>Sequential (oldest first)</option>
                <option value={1}>Random</option>
              </Select>
            </Field>
          </Grid>
        </Section>

        <Section title="Lapses">
          <Grid>
            <Field label="Relearning steps">
              <Input value={relearn} onChange={(e) => setRelearn(e.target.value)} className="font-mono" />
            </Field>
            <Field label="Minimum interval (days)">{num("minLapseIvl")}</Field>
            <Field label="Leech threshold" hint="Lapses before a card is a leech (0 = off)">
              {num("leechThreshold")}
            </Field>
            <Field label="Leech action">
              <Select value={c.leechAction} onChange={(e) => set("leechAction", +e.target.value)}>
                <option value={0}>Suspend card</option>
                <option value={1}>Tag only</option>
              </Select>
            </Field>
          </Grid>
        </Section>

        <Section title="Display order">
          <Grid>
            <Field label="New card gather order">
              <Select value={c.newGatherPriority} onChange={(e) => set("newGatherPriority", +e.target.value)}>
                {NEW_GATHER.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="New card sort order">
              <Select value={c.newSortOrder} onChange={(e) => set("newSortOrder", +e.target.value)}>
                {NEW_SORT.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="New/review order">
              <Select value={c.newMix} onChange={(e) => set("newMix", +e.target.value)}>
                {MIX.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Interday learning/review order">
              <Select value={c.interdayLearningMix} onChange={(e) => set("interdayLearningMix", +e.target.value)}>
                {MIX.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Review sort order">
              <Select value={c.reviewOrder} onChange={(e) => set("reviewOrder", +e.target.value)}>
                {REVIEW_ORDER.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </Grid>
        </Section>

        <Section
          title={
            <span className="flex items-center gap-2">
              FSRS {fsrs ? <Badge color="green">On</Badge> : <Badge>Off: enable in Settings</Badge>}
            </span>
          }
        >
          <Field label={`Desired retention: ${Math.round(c.desiredRetention * 100)}%`} hint="Higher retention means more reviews. 85–92% is a good range for most people.">
            <input type="range" min={0.7} max={0.99} step={0.01} value={c.desiredRetention} onChange={(e) => set("desiredRetention", +e.target.value)} className="w-full accent-brand-600" />
          </Field>
          <Field label="FSRS parameters" hint="21 numbers. Optimize them from your own review history.">
            <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={3} className="w-full rounded-xl border border-app bg-panel px-3 py-2 font-mono text-xs outline-none focus:border-brand-500" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={optimize} loading={optimizing}>
              <Wand2 className="size-4" /> Optimize parameters
            </Button>
            <Button variant="ghost" onClick={async () => setParams((await api.get<{ params: number[] }>("/api/fsrs/defaults")).params.join(", "))}>
              Reset to defaults
            </Button>
          </div>
          {optResult && (
            <div className="flex gap-2 rounded-xl bg-brand-500/8 px-3 py-2 text-sm">
              <Info className="size-4 mt-0.5 shrink-0 text-brand-500" /> {optResult}
            </div>
          )}
          <Switch checked={reschedule} onChange={setReschedule} label="Reschedule cards on save" hint="Recompute due dates of existing review cards with these parameters." />
          <Field label="Maximum interval (days)">{num("maxIvl")}</Field>
        </Section>

        {!fsrs && (
          <Section title="Advanced (SM-2)">
            <Grid>
              <Field label="Starting ease">{num("initialEase", 0.01)}</Field>
              <Field label="Easy bonus">{num("easyMult", 0.01)}</Field>
              <Field label="Interval modifier">{num("ivlMult", 0.01)}</Field>
              <Field label="Hard interval">{num("hardMult", 0.01)}</Field>
              <Field label="New interval" hint="Multiplier on lapse">
                {num("lapseMult", 0.01)}
              </Field>
              <Field label="Maximum interval (days)">{num("maxIvl")}</Field>
            </Grid>
          </Section>
        )}

        <Section title="Burying">
          <Switch checked={c.buryNew} onChange={(v) => set("buryNew", v)} label="Bury new siblings" hint="Delay other new cards of the same note until tomorrow" />
          <Switch checked={c.buryReviews} onChange={(v) => set("buryReviews", v)} label="Bury review siblings" />
          <Switch checked={c.buryInterday} onChange={(v) => set("buryInterday", v)} label="Bury interday learning siblings" />
        </Section>

        <Section title="Audio">
          <Switch checked={!c.disableAutoplay} onChange={(v) => set("disableAutoplay", !v)} label="Play audio automatically" />
          <Switch checked={c.skipQuestionWhenReplayingAnswer} onChange={(v) => set("skipQuestionWhenReplayingAnswer", v)} label="Skip question audio when replaying answer" />
        </Section>

        <Section title="Timer & auto advance">
          <Switch checked={c.showTimer} onChange={(v) => set("showTimer", v)} label="Show answer timer" />
          <Grid>
            <Field label="Maximum answer seconds">{num("capAnswerSecs")}</Field>
            <Field label="Seconds to show question" hint="0 = off">
              {num("autoAdvanceQuestionSecs", 0.5)}
            </Field>
            <Field label="Seconds to show answer" hint="0 = off">
              {num("autoAdvanceAnswerSecs", 0.5)}
            </Field>
            <Field label="Answer action">
              <Select value={c.autoAdvanceAnswerAction} onChange={(e) => set("autoAdvanceAnswerAction", +e.target.value)}>
                {AUTO_ANSWER.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </Grid>
        </Section>

        <Section title="Easy days">
          <p className="text-xs text-muted -mt-1">Relative review load per weekday, applied by the load balancer.</p>
          <div className="grid grid-cols-7 gap-2">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
              <Field key={d} label={d}>
                <Select value={c.easyDays[i] ?? 1} onChange={(e) => set("easyDays", c.easyDays.map((v, j) => (j === i ? +e.target.value : v)))} className="px-1.5">
                  <option value={1}>Normal</option>
                  <option value={0.5}>Reduced</option>
                  <option value={0}>Minimum</option>
                </Select>
              </Field>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </Card>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-3">{children}</div>;
}
