// F017 — a settings page as appkit's lean starter composes it: app-shell's
// PageTabs for the tabs (?tab=, survives reload), @broberg/settings for the
// fields and the one Save button. Typing «fail» as the app name makes the
// server refuse, to show the failed state. Invented data.
// Run: pnpm --filter settings-example dev  →  http://127.0.0.1:5196
import "@broberg/theme/css/palettes.css";
import "@broberg/app-shell/css/app-shell.css";
import "@broberg/settings/css/settings.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { AppShell, PageHeader, PageTabs } from "@broberg/app-shell/preact";
import { generateSecret } from "@broberg/settings";
import { SettingsCard, SettingsField, SettingsInput, SettingsSaveButton, SettingsToggle, useSaveHandler } from "@broberg/settings/preact";

initTheme();
initPalette();

type Settings = { appName: string; supportMail: string; maintenance: boolean; apiKey: string };

async function put(patch: Partial<Settings>): Promise<void> {
  const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
}

function General({ initial }: { initial: Settings }) {
  const [appName, setAppName] = useState(initial.appName);
  const [supportMail, setSupportMail] = useState(initial.supportMail);
  const [maintenance, setMaintenance] = useState(initial.maintenance);
  useSaveHandler(() => put({ appName, supportMail, maintenance }));
  return (
    <SettingsCard title="Generelt" description="Navn og kontakt, som brugerne ser." testid="settings-panel-general">
      <SettingsField label="Appnavn" htmlFor="app-name">
        <SettingsInput id="app-name" testid="settings-app-name" value={appName} onValue={setAppName} />
      </SettingsField>
      <SettingsField label="Supportmail" hint="Vises i bunden af alle mails." htmlFor="support-mail">
        <SettingsInput id="support-mail" testid="settings-support-mail" type="email" value={supportMail} onValue={setSupportMail} />
      </SettingsField>
      <SettingsField label="Vedligehold" hint="Viser en besked i stedet for appen.">
        <SettingsToggle checked={maintenance} onToggle={setMaintenance} label="Vedligehold" testid="settings-maintenance" />
      </SettingsField>
    </SettingsCard>
  );
}

function Integrations({ initial }: { initial: Settings }) {
  const [apiKey, setApiKey] = useState(initial.apiKey);
  useSaveHandler(() => put({ apiKey }));
  return (
    <SettingsCard title="Integrationer" testid="settings-panel-integrations">
      <SettingsField label="API-nøgle" hint="Genereres her; kopiér den til den anden tjeneste." htmlFor="api-key">
        <SettingsInput id="api-key" testid="settings-api-key" value={apiKey} onValue={setApiKey} readOnly copy />
        <button type="button" class="bst-btn" data-testid="settings-api-key-new" style={{ marginTop: "8px" }} onClick={() => { setApiKey(generateSecret(16)); }}>
          Ny nøgle
        </button>
      </SettingsField>
    </SettingsCard>
  );
}

function App() {
  const [url, setUrl] = useState(location.pathname + location.search);
  const [data, setData] = useState<Settings | null>(null);
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setData);
    const onPop = () => setUrl(location.pathname + location.search);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const navigate = (href: string) => {
    history.pushState(null, "", href);
    setUrl(href);
  };
  const tab = new URL(url, location.origin).searchParams.get("tab") ?? "general";
  return (
    <AppShell lang="da" brand={<strong>Acme</strong>} groups={[{ label: "Admin", items: [{ id: "settings", label: "Indstillinger", href: "/" }] }]} currentPath="/" onNavigate={navigate} title="Indstillinger">
      <PageHeader title="Indstillinger" actions={<SettingsSaveButton />} />
      <div class="ex-page">
        <PageTabs tabs={[{ id: "general", label: "Generelt" }, { id: "integrations", label: "Integrationer" }]} currentUrl={url} onNavigate={navigate} />
        <div style={{ marginTop: "16px" }}>
          {data ? (
            <>
              <div hidden={tab !== "general"}><General initial={data} /></div>
              <div hidden={tab !== "integrations"}><Integrations initial={data} /></div>
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

render(<App />, document.getElementById("app")!);
