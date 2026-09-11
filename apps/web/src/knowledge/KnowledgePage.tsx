import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { Notes } from "./Notes";
import { Reading } from "./Reading";
import { Connections, Suggestions } from "./Connections";
import { Entities } from "./Entities";
import { Arguments } from "./Arguments";
import { Comparisons } from "./Comparisons";
const tabs = {
  notes: ["Notes", Notes],
  reading: ["Reading plan", Reading],
  connections: ["Connections", Connections],
  entities: ["Entities", Entities],
  suggestions: ["Suggestions", Suggestions],
  arguments: ["Arguments", Arguments],
  comparisons: ["Comparisons", Comparisons],
} as const;
export function KnowledgePage() {
  const [params, setParams] = useSearchParams(),
    tab = params.get("tab") ?? "notes",
    entry = tabs[tab as keyof typeof tabs] ?? tabs.notes,
    Panel = entry[1];
  return (
    <div className="page knowledge-page">
      <PageHeader
        eyebrow="Connected research"
        title="Develop your understanding"
        description="Plan your reading, connect sources and turn evidence into arguments."
      />
      <nav className="knowledge-tabs" aria-label="Knowledge tools">
        {Object.entries(tabs).map(([id, [label]]) => (
          <button
            key={id}
            className={"button " + (id === tab ? "primary" : "secondary")}
            aria-current={id === tab ? "page" : undefined}
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
