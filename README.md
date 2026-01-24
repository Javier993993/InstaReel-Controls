# InstaReel Controls

Instagram's web reels drove me a little nuts, so I built the controls I wanted
and figured I might as well share them.

## Features
- Vertical volume slider that opens from the native Instagram sound button
- Click to open slider, click again to toggle mute, double click to mute
- Progress bar with time + play/pause status, aligned to the video
- Remembers your volume level across sessions
- Right-click a reel to copy a "share current timestamp" link

## Install (Chrome, unpacked)
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked" and select this folder.

## Repo
GitHub: https://github.com/cealiax3/InstaReel-Controls

## Usage
- Hover or click the Instagram sound button to open the volume slider.
- Drag the slider to adjust volume (saved automatically).
- Right-click a reel and pick "Share current timestamp" to copy a link.

## Screenshots
<img src="assets/screenshots/progress-only.png" width="520" alt="Progress bar embedded in the native UI" />
<img src="assets/screenshots/volume-popover.png" height="200" alt="Volume popover with percentage" />
<img src="assets/screenshots/share-timestamp.png" width="520" alt="Share current timestamp menu" />

## Notes
- Works on `instagram.com` reels and feed posts that contain `<video>` elements.
- Firefox and Chrome Web Store releases are planned later.

## Development
- Edit `content.js` and `content.css`.
- Reload the extension from `chrome://extensions` after changes.

## Privacy
All processing runs locally in your browser. No data is sent anywhere.

## License
MIT - see `LICENSE`.
