import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { Boards } from "./Boards";
import { Reports } from "./Reports";
import { Digests, FeedbackHistory } from "./Monitor";
const tabs = {
  maps: ["Research maps", Boards],
  reports: ["Reading and synthesis", Reports],
  feedback: ["Discovery feedback", FeedbackHistory],
  digests: ["Collection changes", Digests],
} as const;
export function PlanningPage() {
  const [params, setParams] = useSearchParams(),
    tab = params.get("tab") ?? "maps",
    Panel = (tabs[tab as keyof typeof tabs] ?? tabs.maps)[1];
  return (
    <div className="page knowledge-page">
      <PageHeader
        eyebrow="Research planning"
        title="Keep the question and evidence connected"
        description="Arrange a reading map, inspect source-backed interpretations and follow meaningful changes."
      />
      <nav className="knowledge-tabs" aria-label="Research planning tools">
        {Object.entries(tabs).map(([id, [label]]) => (
          <button
            key={id}
            className={"button " + (id === tab ? "primary" : "secondary")}
            onClick={() => setParams({ tab: id })}
          >
            {label}
          </button>
        ))}
      </nav>
      <Panel />
    </div>
  );
}
