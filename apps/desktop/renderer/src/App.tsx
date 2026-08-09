import { useEffect, useState } from "react";
import type { OpenPublicationResult } from "../../../../packages/shared/src/types";
import { ReaderSurface } from "./ReaderSurface";

export function App() {
  const [opened, setOpened] = useState<OpenPublicationResult>();
  const [error, setError] = useState("");

  useEffect(() => {
    void window.ereader.openDefaultFixture().then((result) => {
      setError("");
      setOpened(result);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    const open = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void window.ereader.chooseBook().then((result) => {
          if (result) {
            setError("");
            setOpened(result);
          }
        }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);

  if (error) {
    const message = error.includes("此文件受保护") ? "此文件受保护，无法读取。" : "无法打开此书，文件可能已损坏或格式不受支持。";
    return <div className="center-message">{message}</div>;
  }
  if (!opened) return <div className="center-message">正在打开…</div>;
  return <ReaderSurface opened={opened} />;
}
