# Shipping Latent to TestFlight

Two paths, same project (`ios/project.yml`, generated with XcodeGen):

- **Fully CI**: GitHub Actions (macOS runner) -> fastlane -> TestFlight. No Mac needed.
- **Local Xcode**: generate the project, archive, and upload from Xcode on a Mac.

TestFlight builds cannot reach `localhost`, so deploy the backend first (section 4) and point
`API_BASE_URL` at it.

## 1. Prerequisites

- Apple Developer Program membership (US$99/year): <https://developer.apple.com/programs/>
- Your **Team ID** (10 characters): developer.apple.com -> Account -> Membership details.
- App Store Connect access with the Account Holder or Admin role (needed to create API keys).
- A GitHub repo with Actions enabled (`BenjaminHannan/latent`).

Bundle ID used throughout: `com.benjaminhannan.latent` (set in `ios/Config/Base.xcconfig`).
If you want a different one, change it there and in `ios/fastlane/Appfile`.

## 2. One-time Apple setup

### 2.1 Register the bundle ID and create the app record

1. developer.apple.com -> Certificates, IDs & Profiles -> Identifiers -> **+** -> App IDs -> App ->
   Description `Latent`, Bundle ID (Explicit) `com.benjaminhannan.latent`. No extra capabilities needed.
2. appstoreconnect.apple.com -> Apps -> **+** -> New App -> Platform iOS, Name `Latent`,
   Primary language English, Bundle ID `com.benjaminhannan.latent`, SKU `latent-ios`, Full Access.

Optional automation: once the API key exists, `bundle exec fastlane register_app` (in `ios/`, with the
`ASC_*` and `APPLE_TEAM_ID` env vars set) runs `produce` to do both. Apple restricts creating the app
record through the API key, so if that step fails, create the app in the web UI (step 2 above) once.
The name `Latent` may already be taken globally; pick a variant (the home-screen name stays `Latent`).

### 2.2 App Store Connect API key

1. App Store Connect -> Users and Access -> Integrations -> App Store Connect API -> Team Keys -> **+**.
2. Name `latent-ci`, Access **App Manager**. Download the `.p8` (only possible once).
3. Note the **Key ID** and the **Issuer ID** (shown at the top of the page).
4. Base64 the key (single line):

   ```sh
   base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n' > asc_key.b64    # macOS
   base64 -w0 AuthKey_XXXXXXXXXX.p8 > asc_key.b64                # Linux
   ```

### 2.3 Apple Distribution certificate (.p12), no Mac required

Do this in a scratch directory and keep the files private. Never commit them.

```sh
# 1. Private key + certificate signing request
openssl genrsa -out latent_dist.key 2048
openssl req -new -key latent_dist.key -out latent_dist.csr \
  -subj "/emailAddress=you@example.com/CN=Your Name/C=US"
```

2. developer.apple.com -> Certificates -> **+** -> **Apple Distribution** -> upload `latent_dist.csr`
   -> download `distribution.cer`. (Apple allows only a few distribution certs per team; reuse one if
   you already have it, as long as you still have its private key.)

```sh
# 3. DER .cer -> PEM
openssl x509 -inform DER -in distribution.cer -out distribution.pem

# 4. Bundle key + cert into a .p12 (pick a password)
openssl pkcs12 -export -inkey latent_dist.key -in distribution.pem \
  -name "Apple Distribution" -out latent_dist.p12 -passout pass:CHOOSE_A_PASSWORD
```

If you have OpenSSL 3.x and the CI keychain import later fails with "MAC verification failed" or
"wrong password", re-export with the legacy encryption the macOS keychain understands:

```sh
openssl pkcs12 -export -legacy -inkey latent_dist.key -in distribution.pem \
  -name "Apple Distribution" -out latent_dist.p12 -passout pass:CHOOSE_A_PASSWORD
# (or, without -legacy:  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1)
```

```sh
# 5. Base64 for the GitHub secret
base64 -w0 latent_dist.p12 > dist_cert.b64        # Linux  (macOS: base64 -i latent_dist.p12 | tr -d '\n')
```

Keep `latent_dist.key` and `latent_dist.p12` somewhere safe: the key cannot be recovered from Apple.

### 2.4 GitHub secrets

Repo -> Settings -> Secrets and variables -> Actions -> New repository secret. Exactly these six:

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | API key ID (e.g. `ABC123DEFG`) |
| `ASC_ISSUER_ID` | API issuer UUID |
| `ASC_KEY_P8_BASE64` | contents of `asc_key.b64` |
| `IOS_DIST_CERT_P12_BASE64` | contents of `dist_cert.b64` |
| `IOS_DIST_CERT_PASSWORD` | the password you chose for the `.p12` |
| `APPLE_TEAM_ID` | your 10-character Team ID |

With the GitHub CLI:

```sh
gh secret set ASC_KEY_ID -R BenjaminHannan/latent
gh secret set ASC_ISSUER_ID -R BenjaminHannan/latent
gh secret set ASC_KEY_P8_BASE64 -R BenjaminHannan/latent < asc_key.b64
gh secret set IOS_DIST_CERT_P12_BASE64 -R BenjaminHannan/latent < dist_cert.b64
gh secret set IOS_DIST_CERT_PASSWORD -R BenjaminHannan/latent
gh secret set APPLE_TEAM_ID -R BenjaminHannan/latent
```

The TestFlight workflow checks all six up front and fails with a list of any that are missing.

### 2.5 Project config

Edit `ios/Config/Base.xcconfig`:

- `DEVELOPMENT_TEAM = YOURTEAMID` (needed for the local Xcode path; CI uses `APPLE_TEAM_ID`).
- `API_BASE_URL = https:/$()/<your-fly-app>.fly.dev`. Write `https:/$()/` and not `https://`, because
  `//` starts a comment in xcconfig files. Debug builds use `http://localhost:8787` (`Debug.xcconfig`).
- `MARKETING_VERSION` is the user-visible version. The build number is set automatically
  (latest TestFlight build + 1) by the `beta` lane.

## 3. Ship a build (CI)

- GitHub -> Actions -> **TestFlight** -> Run workflow, or
- push a tag: `git tag ios-v0.1.0 && git push origin ios-v0.1.0`.

(The tag only triggers the workflow; the version number comes from `MARKETING_VERSION`.)

The workflow builds, signs, uploads, and returns without waiting for Apple's processing. The build shows
up in App Store Connect -> TestFlight after about 5-30 minutes ("Processing"). The `.ipa` is also kept as a
workflow artifact. Pull requests run `iOS CI` (build + unit tests, unsigned) automatically.

## 4. Deploy the backend (Fly.io)

From the repo root (`fly.toml` and `server/Dockerfile` are already there):

```sh
fly auth login
fly launch --no-deploy --copy-config --name latent-api    # pick another name if taken, then update API_BASE_URL
fly volumes create latent_data --region iad --size 3      # SQLite + uploaded media live here
fly deploy
curl -i https://latent-api.fly.dev/                       # 200 = healthy
```

Optional demo data (4 users `ava`, `noah`, `mia`, `leo`, password `password`; do not leave on a public
server you care about):

```sh
fly ssh console -C "node /app/server/dist/server/src/seed.js"
```

The server also serves the web PWA at `/`. If you rename the Fly app, update `app` in `fly.toml` and
`API_BASE_URL` in `ios/Config/Base.xcconfig`. Fly can only run a single machine with a single volume here,
which suits SQLite; do not scale out to several machines.

## 5. Testers

- **Internal testing** (up to 100 people on your App Store Connect team): TestFlight -> Internal Testing
  -> **+** group -> add testers (they must be users in App Store Connect). New builds are available
  immediately after processing.
- **External testing** (up to 10,000 people, by email or public link): TestFlight -> External Testing ->
  new group -> add the build. The first build of each version goes through **Beta App Review**
  (usually under a day). Fill in Test Information (contact, "what to test"). No login is needed for review
  unless you require one; since Latent needs an account, give the reviewer a demo username and password.
- Testers install the TestFlight app from the App Store and accept the invite.

## 6. Local Xcode alternative (needs a Mac)

```sh
brew install xcodegen
cd ios && xcodegen generate && open Latent.xcodeproj
```

1. Set `DEVELOPMENT_TEAM` in `Config/Base.xcconfig` (or pick the team under Latent target -> Signing &
   Capabilities; signing is Automatic locally).
2. Select **Any iOS Device (arm64)**, then Product -> Archive.
3. Organizer -> Distribute App -> App Store Connect -> Upload. Xcode manages the certificate and profile.
4. Bump `CURRENT_PROJECT_VERSION` in `Base.xcconfig` for every upload (App Store Connect rejects duplicates).

You can also run the lane locally: `cd ios && bundle install && bundle exec fastlane beta` with the same
env vars as the secrets table (it imports the `.p12` only when `CI=true`; locally it uses your keychain).

## 7. Troubleshooting

- **"Missing Compliance" on every build**: `ITSAppUsesNonExemptEncryption=false` is already in
  `Info.plist`. If you add custom cryptography, set it to `true` and answer Apple's questions.
- **Upload rejected: "Invalid large app icon / alpha channel"**: the 1024x1024 icon must have no alpha.
  Check with `identify -format '%[channels]' AppIcon-1024.png` (should be `srgb`, not `srgba`); re-export
  with `convert in.png -background '#0B0B0C' -flatten -alpha off out.png`.
- **"The bundle version must be higher than the previously uploaded version"**: the build number was
  used. The `beta` lane takes latest TestFlight build + 1; if you uploaded from Xcode in between, rerun the
  workflow (it re-reads the latest). Locally, bump `CURRENT_PROJECT_VERSION`.
- **No signing certificate / "MAC verification failed"** in CI: the `.p12` password is wrong or the `.p12`
  was exported with OpenSSL 3 defaults; re-export with `-legacy` (section 2.3).
- **"No profiles for com.benjaminhannan.latent"**: the bundle ID is not registered, or the API key lacks
  the App Manager role (section 2).
- **`xcodegen: command not found`** locally: `brew install xcodegen`.
- **Camera does not work in the Simulator**: the simulator has no camera. Test capture on a physical
  iPhone (via TestFlight or Xcode). Everything else (feed, profile, auth) works in the Simulator.
- **App cannot reach the server**: TestFlight builds use `API_BASE_URL` from Base.xcconfig (Release).
  Confirm `curl https://<host>/api/me` returns 401 JSON, and that you used `https:/$()/`.
