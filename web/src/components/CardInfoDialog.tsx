import { api, fmt } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Loading, Modal, Badge } from "./ui";

interface Info {
  id: number;
  noteId: number;
  added: number;
  firstReview: number | null;
  latestReview: number | null;
  due: number | null;
  position: number | null;
  interval: number | null;
  ease: number | null;
  reviews: number;
  lapses: number;
  averageTimeMs: number | null;
  totalTimeMs: number;
  cardType: string;
  notetype: string;
  deck: string;
  filteredDeck: string | null;
  stability: number | null;
  difficulty: number | null;
  retrievability: number | null;
  desiredRetention: number;
  state: string;
  queue: number;
  revlog: { id: number; ease: number; ivl: number; lastIvl: number; factor: number; time: number; type: number }[];
}

const TYPE = ["Learn", "Review", "Relearn", "Filtered", "Manual", "Rescheduled"];
const EASE = ["Manual", "Again", "Hard", "Good", "Easy"];
const EASE_COLOR = ["zinc", "red", "amber", "green", "blue"] as const;

function ivlText(ivl: number) {
  if (ivl < 0) return `${Math.round(-ivl / 60)}m`;
  return fmt.ivl(ivl);
}

export default function CardInfoDialog({ cardId, onClose }: { cardId: number | null; onClose: () => void }) {
  const { data } = useApi(() => (cardId ? api.get<Info>(`/api/cards/${cardId}/info`) : Promise.resolve(null)), [cardId]);
  const rows: [string, React.ReactNode][] = data
    ? [
        ["Added", fmt.date(data.added)],
        ["First review", data.firstReview ? fmt.date(data.firstReview) : "–"],
        ["Latest review", data.latestReview ? fmt.date(data.latestReview) : "–"],
        [data.position != null ? "Position" : "Due", data.position != null ? `#${data.position}` : data.due ? fmt.date(data.due) : "–"],
        ["Interval", data.interval ? fmt.ivl(data.interval) : "–"],
        ["Ease", data.ease ? `${Math.round(data.ease)}%` : "–"],
        ["Reviews", data.reviews],
        ["Lapses", data.lapses],
        ["Average time", data.averageTimeMs ? `${(data.averageTimeMs / 1000).toFixed(1)}s` : "–"],
        ["Total time", fmt.duration(data.totalTimeMs)],
        ["Stability", data.stability != null ? fmt.ivl(data.stability) : "–"],
        ["Difficulty", data.difficulty != null ? `${Math.round(data.difficulty * 100)}%` : "–"],
        ["Retrievability", data.retrievability != null ? `${Math.round(data.retrievability * 100)}%` : "–"],
        ["Card type", data.cardType],
        ["Note type", data.notetype],
        ["Deck", data.filteredDeck ? `${data.filteredDeck} (${data.deck})` : data.deck],
        ["Card ID", data.id],
        ["Note ID", data.noteId],
      ]
    : [];
  return (
    <Modal open={!!cardId} onClose={onClose} title="Card info" wide>
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex gap-2">
            <Badge color="brand">{data.state}</Badge>
            {data.queue === -1 && <Badge color="amber">Suspended</Badge>}
            {(data.queue === -2 || data.queue === -3) && <Badge color="zinc">Buried</Badge>}
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-medium tabular-nums truncate">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="text-sm font-semibold mb-2">Review history</h3>
            {data.revlog.length === 0 ? (
              <p className="text-sm text-muted">No reviews yet.</p>
            ) : (
              <div className="rounded-xl border border-app overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-panel-2 text-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-left px-3 py-2 font-medium">Rating</th>
                      <th className="text-right px-3 py-2 font-medium">Interval</th>
                      <th className="text-right px-3 py-2 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.revlog.map((r) => (
                      <tr key={r.id} className="border-t border-app">
                        <td className="px-3 py-1.5">{fmt.datetime(r.id)}</td>
                        <td className="px-3 py-1.5">{TYPE[r.type] ?? r.type}</td>
                        <td className="px-3 py-1.5">
                          <Badge color={EASE_COLOR[r.ease] ?? "zinc"}>{EASE[r.ease] ?? r.ease}</Badge>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{ivlText(r.ivl)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{(r.time / 1000).toFixed(1)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
