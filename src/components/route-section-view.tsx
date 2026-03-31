"use client";

import dynamic from "next/dynamic";
import { DashboardView } from "@/components/dashboard-view";
import { PanelErrorBoundary } from "@/components/panel-error-boundary";
import { GatewayOfflineBanner } from "@/components/gateway-offline-banner";

function SectionLoading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
      </div>
    </div>
  );
}

const TasksView = dynamic(
  () => import("@/components/tasks-view").then((m) => m.TasksView),
  { loading: () => <SectionLoading /> }
);
const CronView = dynamic(
  () => import("@/components/cron-view").then((m) => m.CronView),
  { loading: () => <SectionLoading /> }
);
const HeartbeatView = dynamic(
  () => import("@/components/heartbeat-view").then((m) => m.HeartbeatView),
  { loading: () => <SectionLoading /> }
);
const MemoryView = dynamic(
  () => import("@/components/memory-view").then((m) => m.MemoryView),
  { loading: () => <SectionLoading /> }
);
const DocsView = dynamic(
  () => import("@/components/docs-view").then((m) => m.DocsView),
  { loading: () => <SectionLoading /> }
);
const SkillsView = dynamic(
  () => import("@/components/skills-view").then((m) => m.SkillsView),
  { loading: () => <SectionLoading /> }
);
const LogsView = dynamic(
  () => import("@/components/logs-view").then((m) => m.LogsView),
  { loading: () => <SectionLoading /> }
);
const VectorView = dynamic(
  () => import("@/components/vector-view").then((m) => m.VectorView),
  { loading: () => <SectionLoading /> }
);
const AgentsView = dynamic(
  () => import("@/components/agents-view").then((m) => m.AgentsView),
  { loading: () => <SectionLoading /> }
);
const UsageView = dynamic(
  () => import("@/components/usage-view").then((m) => m.UsageView),
  { loading: () => <SectionLoading /> }
);
const TerminalView = dynamic(
  () => import("@/components/terminal-view").then((m) => m.TerminalView),
  { loading: () => <SectionLoading /> }
);
const SecurityView = dynamic(
  () => import("@/components/security-view").then((m) => m.SecurityView),
  { loading: () => <SectionLoading /> }
);
const AccountsKeysView = dynamic(
  () => import("@/components/accounts-keys-view").then((m) => m.AccountsKeysView),
  { loading: () => <SectionLoading /> }
);
const SettingsView = dynamic(
  () => import("@/components/settings-view").then((m) => m.SettingsView),
  { loading: () => <SectionLoading /> }
);
const HooksView = dynamic(
  () => import("@/components/hooks-view").then((m) => m.HooksView),
  { loading: () => <SectionLoading /> }
);
const DoctorView = dynamic(
  () => import("@/components/doctor-view").then((m) => m.DoctorView),
  { loading: () => <SectionLoading /> }
);
const TimelineView = dynamic(
  () => import("@/components/timeline-view").then((m) => m.TimelineView),
  { loading: () => <SectionLoading /> }
);
const EnvManagerView = dynamic(
  () => import("@/components/env-manager-view").then((m) => m.EnvManagerView),
  { loading: () => <SectionLoading /> }
);
const HelpView = dynamic(
  () => import("@/components/help-view").then((m) => m.HelpView),
  { loading: () => <SectionLoading /> }
);

export type DashboardSection =
  | "dashboard"
  | "agents"
  | "tasks"
  | "cron"
  | "heartbeat"
  | "memory"
  | "docs"
  | "skills"
  | "accounts"
  | "vectors"
  | "logs"
  | "usage"
  | "terminal"
  | "security"
  | "permissions"
  | "settings"
  | "hooks"
  | "doctor"
  | "timeline"
  | "env"
  | "help";

function SectionContent({ section }: { section: DashboardSection }) {
  switch (section) {
    case "dashboard":
      return <DashboardView />;
    case "agents":
      return <AgentsView />;
    case "tasks":
      return <TasksView />;
    case "cron":
      return <CronView />;
    case "heartbeat":
      return <HeartbeatView />;
    case "memory":
      return <MemoryView />;
    case "docs":
      return <DocsView />;
    case "skills":
      return <SkillsView />;
    case "accounts":
      return <AccountsKeysView />;
    case "vectors":
      return <VectorView />;
    case "logs":
      return <LogsView />;
    case "usage":
      return <UsageView />;
    case "terminal":
      return <TerminalView />;
    case "security":
      return <SecurityView initialTab="health" />;
    case "permissions":
      return <SecurityView initialTab="permissions" />;
    case "settings":
      return <SettingsView />;
    case "hooks":
      return <HooksView />;
    case "doctor":
      return <DoctorView />;
    case "timeline":
      return <TimelineView />;
    case "env":
      return <EnvManagerView />;
    case "help":
      return <HelpView />;
    default:
      return <DashboardView />;
  }
}

export function RouteSectionView({ section }: { section: DashboardSection }) {
  return (
    <PanelErrorBoundary key={section} section={section}>
      {section !== "dashboard" && <GatewayOfflineBanner />}
      <SectionContent section={section} />
    </PanelErrorBoundary>
  );
}
