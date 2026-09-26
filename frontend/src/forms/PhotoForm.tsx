import { Camera, ImagePlus } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { Field } from "../components/Field";
import { localInputToIso, toLocalInputValue } from "../lib/format";
import type { NewPhoto } from "../lib/photos";
import type { Photo, Pose } from "../lib/types";

const POSES: { key: Pose; label: string }[] = [
  { key: "front", label: "Front" },
  { key: "side", label: "Side" },
  { key: "back", label: "Back" },
];

type Props = {
  lastByPose: Partial<Record<Pose, Photo>>;
  onSubmit: (p: NewPhoto) => Promise<void>;
};

export function PhotoForm({ lastByPose, onSubmit }: Props) {
  const [pose, setPose] = useState<Pose>("front");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState(() => toLocalInputValue(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guide = lastByPose[pose];

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ file, pose, takenAt: localInputToIso(takenAt), note: note.trim() || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Pose" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {POSES.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={pose === p.key}
            onClick={() => setPose(p.key)}
            className={`flex-1 rounded-lg py-1.5 text-sm ${
              pose === p.key ? "bg-surface text-text shadow-sm" : "text-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-surface-2">
        {preview && (
          <img
            src={preview}
            alt="New photo preview"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {preview && guide && (
          <img
            src={guide.url}
            alt={`Previous ${pose} photo`}
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
        )}
        {!preview && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">
            No photo selected
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm">
          <Camera size={18} /> Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={pick}
          />
        </label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm">
          <ImagePlus size={18} /> Choose from gallery
          <input type="file" accept="image/*" className="sr-only" onChange={pick} />
        </label>
      </div>

      <Field
        label="Date & time"
        type="datetime-local"
        value={takenAt}
        onChange={(e) => setTakenAt(e.target.value)}
      />
      <Field label="Note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!file || busy}
        className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60"
      >
        {busy ? "Uploading…" : "Save photo"}
      </button>
    </form>
  );
}
