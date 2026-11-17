import "@/app/graphite.css";

/**
 * The owner's journey (share page, owner page) is one product in the graphite + lime look. The marker class
 * switches the tokens on <body> (graphite.css), so the site header and footer follow. Other routes stay light.
 */
export default function OwnerLayout({ children }: LayoutProps<"/b/[ownerId]">) {
  return <div className="owner-theme">{children}</div>;
}
