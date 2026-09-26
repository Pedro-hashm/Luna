"use client";

import { useEffect, useState } from "react";
import { getWakeModelStatus, type WakeModelStatus } from "@/lib/voice-api";

export function WakeModelStatusBadge({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<WakeModelStatus>();

  useEffect(() => {
    let active = true;
    void getWakeModelStatus().then((result) => {
      if (active) setStatus(result);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!status) return null;
  if (!status.modelReady) return <p className={`text-xs text-amber-700 ${className}`}>Wake: modelo não instalado</p>;
  if (status.validationState === "validated") return null;

  return <p className={`text-xs text-amber-700 ${className}`}>
    Wake: modelo {status.validationState === "provisional" ? "provisório" : "sem validação"}
  </p>;
}
