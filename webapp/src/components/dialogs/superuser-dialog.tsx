"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useCalendar } from "@/calendar/contexts/calendar-context";

/**
 * Asks for the superuser passphrase in a masked field rather than the search
 * box, where it would be shown in plain text, left in the box, and offered to
 * autofill. The phrase is only ever sent to the Worker, which compares it
 * against a hashed secret — nothing here knows what it should be.
 */
export function SuperuserDialog() {
  const { askForSuperuser, setAskForSuperuser, setSuperuser } = useCalendar();
  const toast = useToast();

  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Never leave the phrase sitting in state once the dialog is closed.
  useEffect(() => {
    if (askForSuperuser) return;
    setPhrase("");
    setError("");
    setSubmitting(false);
  }, [askForSuperuser]);

  const submit = async () => {
    if (!phrase || submitting) return;
    setSubmitting(true);
    setError("");

    try {
      await api("/api/superuser", { method: "POST", body: JSON.stringify({ phrase }) });
      setSuperuser(true);
      setPhrase("");
      setAskForSuperuser(false);
      toast("Superuser enabled — events can now be renamed and deleted.", "success");
    } catch (err) {
      setSuperuser(false);
      setPhrase("");
      setError(err instanceof Error ? err.message : "That passphrase is not right.");
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={askForSuperuser} onOpenChange={setAskForSuperuser}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            Enable superuser
          </DialogTitle>
          <DialogDescription>Renaming and deleting events stay switched off until this is confirmed.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="superuser-phrase">Passphrase</Label>
          <Input
            id="superuser-phrase"
            ref={inputRef}
            type="password"
            autoComplete="off"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={phrase}
            onChange={e => setPhrase(e.target.value)}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void submit();
            }}
            data-invalid={!!error}
          />
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setAskForSuperuser(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!phrase || submitting}>
            {submitting ? "Checking…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
