# latent

Strava for deep work: battery-friendly timelapses of your focus sessions. See [SPEC.md](SPEC.md).

## iOS app

Native SwiftUI app (iOS 17+, iPhone) in [`ios/`](ios/), generated with XcodeGen
(`cd ios && xcodegen generate && open Latent.xcodeproj`). GitHub Actions builds and tests it on every PR
(`.github/workflows/ios.yml`) and ships it to TestFlight via fastlane (`testflight.yml`, run manually or by
pushing a tag like `ios-v0.1.0`). The backend deploys to Fly.io with `fly.toml` and `server/Dockerfile`.
Step-by-step setup: [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md).
