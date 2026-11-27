"use client";

import { ArrowRight, Check, Users, X } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import {
  AGE_GROUP_OPTIONS,
  COMMUTE_OPTIONS,
  DEFAULT_PREFERENCES,
  OCCUPATION_OPTIONS,
  OUTDOOR_ACTIVITY_OPTIONS,
  type UserPreferences
} from "@/types/preferences";
import { useDialogFocus } from "@/components/use-dialog-focus";

function selectOption<const Options extends readonly string[]>(
  options: Options,
  value: string,
  fallback: Options[number]
): Options[number] {
  return options.find((option) => option === value) ?? fallback;
}

export default function PreferencesDialog({
  initial, onClose, onSave
}: {
  initial: UserPreferences;
  onClose: () => void;
  onSave: (preferences: UserPreferences) => void;
}) {
  const [value, setValue] = useState(initial);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(value);
  }

  function clear() {
    setValue(DEFAULT_PREFERENCES);
    onSave(DEFAULT_PREFERENCES);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="dialog-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" aria-describedby="profile-dialog-copy">
        <button className="dialog-close" aria-label="Close preferences" onClick={onClose}><X size={18} /></button>
        <span className="dialog-icon profile-dialog-icon"><Users size={20} /></span>
        <div className="eyebrow"><span /> Optional personalization</div>
        <h2 id="profile-dialog-title">Make the advice fit</h2>
        <p className="dialog-copy" id="profile-dialog-copy">Share only what helps tailor everyday suggestions. Preferences stay in this browser and can be changed or cleared any time.</p>
        <form className="dialog-form" onSubmit={submit}>
          <div className="profile-fields">
            <label>Age group
              <select value={value.ageGroup} onChange={(event) => setValue({ ...value, ageGroup: selectOption(AGE_GROUP_OPTIONS, event.target.value, value.ageGroup) })}>
                {AGE_GROUP_OPTIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Occupation
              <select value={value.occupation} onChange={(event) => setValue({ ...value, occupation: selectOption(OCCUPATION_OPTIONS, event.target.value, value.occupation) })}>
                {OCCUPATION_OPTIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Usual commute
              <select value={value.commute} onChange={(event) => setValue({ ...value, commute: selectOption(COMMUTE_OPTIONS, event.target.value, value.commute) })}>
                {COMMUTE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Outdoor activity
              <select value={value.outdoorActivity} onChange={(event) => setValue({ ...value, outdoorActivity: selectOption(OUTDOOR_ACTIVITY_OPTIONS, event.target.value, value.outdoorActivity) })}>
                {OUTDOOR_ACTIVITY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="check-options">
            <label><input type="checkbox" checked={value.children} onChange={(event) => setValue({ ...value, children: event.target.checked })} /> Children live in my household</label>
            <label><input type="checkbox" checked={value.olderAdults} onChange={(event) => setValue({ ...value, olderAdults: event.target.checked })} /> Older adults live in my household</label>
          </div>
          <p className="profile-privacy">AIRWISE does not ask for medical history or diagnoses.</p>
          <div className="dialog-actions">
            <button type="button" className="quiet-button" onClick={clear}>Clear preferences</button>
            <button type="submit" className="primary-button">Save preferences <Check size={15} /></button>
          </div>
          <button type="button" className="skip-link" onClick={onClose}>Skip for now <ArrowRight size={13} /></button>
        </form>
      </section>
    </div>
  );
}
