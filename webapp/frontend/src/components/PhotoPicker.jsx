/**
 * PhotoPicker: choose and upload up to MAX_PHOTOS_PER_REPORT photos (ADR 0008).
 * OWNER: agent "photos-captcha". Placeholder until implemented.
 *
 * @param {{
 *   value: string[],                        // object names of finished uploads
 *   onChange: (objectNames: string[]) => void,
 *   onBusyChange?: (busy: boolean) => void, // true while any upload is in flight
 *   disabled?: boolean,
 * }} props
 */
export default function PhotoPicker() {
  return <div data-testid="photo-picker">Photo picker (not built yet)</div>
}
