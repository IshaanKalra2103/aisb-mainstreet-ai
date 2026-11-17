/**
 * The owner's journey (share page, owner page). The root layout already renders the .owner-theme marker around every
 * page (graphite + lime, graphite.css); this keeps the owner routes marked even if that ever changes.
 */
export default function OwnerLayout({ children }: LayoutProps<"/b/[ownerId]">) {
  return <div className="owner-theme">{children}</div>;
}
