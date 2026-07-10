import { useDashboardData } from "../lib/data";
import {
  describeRecipeEdit,
  formatTime,
  relativeTime,
  shortHash,
} from "../lib/format";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRows } from "../components/Skeleton";

/**
 * Recipe-edits view (CLOUD-35, PRD §5.4) — THE distinct feed, restyled
 * (epic #184, #189). A recipe-family edit that rode up on a publish is shown as
 * its OWN kind of event (amber rail + "recipe edit" tag + "affects N pages"
 * warning) so the human notices and can roll back. The `.recipe-edit` class +
 * `data-recipe-edit` marker are the load-bearing distinct styling the tests pin.
 */
export function RecipeEditsView() {
  const { recipeEdits } = useDashboardData();

  if (recipeEdits === undefined) {
    return <SkeletonRows count={3} label="Loading recipe edits" />;
  }
  if (recipeEdits.length === 0) {
    return <EmptyState icon="✎" title="No recipe edits yet" />;
  }

  return (
    <ul data-testid="recipe-edits-view" className="list-none space-y-2">
      {recipeEdits.map((e) => (
        <li
          key={e.id}
          data-testid="recipe-edit-row"
          data-recipe-edit="true"
          className="recipe-edit flex gap-3 rounded-lg border border-border p-3"
        >
          <span className="badge recipe-kind shrink-0 self-start">
            recipe edit
          </span>
          <div className="flex-1">
            <div className="text-sm">{describeRecipeEdit(e)}</div>
            <div className="@caption tabular-nums">
              body {shortHash(e.bodySha)} ·{" "}
              <span title={formatTime(e.createdAt)}>
                {relativeTime(e.createdAt)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
