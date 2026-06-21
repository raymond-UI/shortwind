import { useDashboardData } from "../lib/data";
import { describeRecipeEdit, formatTime, shortHash } from "../lib/format";

/**
 * Recipe-edits view (CLOUD-35, PRD §5.4) — THE distinct feed.
 *
 * This is the key dashboard feature: a recipe-family edit that an agent rode up
 * on a publish is shown as its OWN kind of event — visually distinct from an
 * ordinary page edit (amber rail + "recipe edit" tag + the "affects N pages on
 * next publish" warning) — so the human notices it and can roll back. The
 * `.recipe-edit` class + `data-recipe-edit` marker are the load-bearing distinct
 * styling the component test asserts on.
 */
export function RecipeEditsView() {
  const { recipeEdits } = useDashboardData();

  if (recipeEdits === undefined) {
    return <div className="empty">Loading recipe edits…</div>;
  }
  if (recipeEdits.length === 0) {
    return <div className="empty">No recipe edits yet.</div>;
  }

  return (
    <div className="panel" data-testid="recipe-edits-view">
      {recipeEdits.map((e) => (
        <div
          className="row recipe-edit"
          key={e.id}
          data-testid="recipe-edit-row"
          data-recipe-edit="true"
        >
          <span className="badge recipe-kind">recipe edit</span>
          <div style={{ flex: 1 }}>
            <div>{describeRecipeEdit(e)}</div>
            <div className="muted mono">
              body {shortHash(e.bodySha)} · {formatTime(e.createdAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
