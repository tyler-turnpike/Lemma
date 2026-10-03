import { DashboardShell } from "../components/dashboard/Shell.js";
import { MessageState } from "../components/dashboard/States.js";
import { PillLink } from "../components/PillLink.js";
import { dashboard } from "../content.js";

export function NotFoundPage() {
  return (
    <DashboardShell active={null}>
      <MessageState state="not-found" tag="404" title={dashboard.notFound.title} body={dashboard.notFound.body}>
        <PillLink href="/">{dashboard.notFound.cta}</PillLink>
      </MessageState>
    </DashboardShell>
  );
}
