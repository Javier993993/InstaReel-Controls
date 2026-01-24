# InstaReel Controls

A free-time side project: Instagram's web reels drove me a little nuts, so I
built the controls I wanted and figured I might as well share them.

## Features
- Native-feeling progress bar with time + play/pause status
- Volume popover from the Instagram sound button (vertical on reels, horizontal on stories)
- Click to open slider, click again to toggle mute, double click to mute
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
- On Stories, the slider opens horizontally next to the sound button.

## Screenshots
<table>
  <tr>
    <td align="center">
      <img src="assets/screenshots/progress-only.png" width="520" alt="Progress bar embedded in the native UI" />
      <br />
      <sub>Progress bar sits in the native UI</sub>
    </td>
    <td align="center">
      <img src="assets/screenshots/volume-popover.png" height="200" alt="Volume popover with percentage" />
      <br />
      <sub>Volume popover with percent readout</sub>
    </td>
  </tr>
</table>
<div align="center">
  <img src="assets/screenshots/share-timestamp.png" width="520" alt="Share current timestamp menu" />
  <br />
  <sub>Right-click to copy a timestamp link</sub>
</div>
<div align="center">
  <img src="assets/screenshots/stories-slider.png" width="520" alt="Stories horizontal volume slider" />
  <br />
  <sub>Stories: horizontal slider next to the sound button</sub>
</div>

## Notes
- Works on `instagram.com` reels, feed posts, and stories that contain `<video>` elements.
- Firefox and Chrome Web Store releases are planned later.

## Development
- Edit `content.js` and `content.css`.
- Reload the extension from `chrome://extensions` after changes.

## Privacy
All processing runs locally in your browser. No data is sent anywhere.

## License
MIT - see `LICENSE`.
