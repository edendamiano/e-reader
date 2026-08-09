import type { ReaderSettings } from "../../../../packages/shared/src/types";

interface SettingsViewProps {
  settings: ReaderSettings;
  onChange(settings: ReaderSettings): Promise<void>;
  onBack(): void;
}

export function SettingsView({ settings, onChange, onBack }: SettingsViewProps) {
  const update = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void onChange({ ...settings, [key]: value });
  return (
    <main className="settings-shell" data-testid="settings-view">
      <header><button type="button" className="back-button" onClick={onBack}>← 书架</button><h1>设置</h1></header>
      <section>
        <h2>阅读</h2>
        <label>字体<select value={settings.fontFamily} onChange={(event) => update("fontFamily", event.target.value as ReaderSettings["fontFamily"])}><option value="serif">衬线</option><option value="sans">无衬线</option></select></label>
        <label>字号 <output>{settings.fontSize}</output><input aria-label="字号" type="range" min="14" max="36" step="1" value={settings.fontSize} onChange={(event) => update("fontSize", Number(event.target.value))} /></label>
        <label>行距 <output>{settings.lineHeight.toFixed(2)}</output><input aria-label="行距" type="range" min="1.3" max="2.2" step="0.05" value={settings.lineHeight} onChange={(event) => update("lineHeight", Number(event.target.value))} /></label>
        <label>页边距 <output>{settings.pageMargin}%</output><input aria-label="页边距" type="range" min="4" max="16" step="1" value={settings.pageMargin} onChange={(event) => update("pageMargin", Number(event.target.value))} /></label>
        <label>页面<select value={settings.theme} onChange={(event) => update("theme", event.target.value as ReaderSettings["theme"])}><option value="day">日间</option><option value="night">夜间</option></select></label>
        <label className="checkbox-row"><input type="checkbox" checked={settings.showProgress} onChange={(event) => update("showProgress", event.target.checked)} />显示阅读进度</label>
      </section>
      <section>
        <h2>朗读</h2>
        <label>朗读速度 <output>{settings.speechRate.toFixed(2)}×</output><input aria-label="朗读速度" type="range" min="0.5" max="2" step="0.05" value={settings.speechRate} onChange={(event) => update("speechRate", Number(event.target.value))} /></label>
      </section>
    </main>
  );
}
