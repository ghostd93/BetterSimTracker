# BetterSimTracker Update & Release Workflow

This is the required checklist for every change.

## Every update (even tiny patch)
1. Update version:
   - package.json
   - manifest.json
2. Update CHANGELOG.md:
   - Move items into Added / Changed / Fixed / Removed
   - Keep [Unreleased] at the top
   - If it’s a release, add "And more..." as the final line in that release block
3. Update README.md if behavior, UI, or settings changed.
4. Build:
   - npm run build
5. Commit changes in this order:
   - Code changes
   - Version + changelog + README (if needed)
   - dist build
6. Push dev.

## Release
1. Merge dev -> main
2. Tag release
3. Create GitHub release with formatted notes
4. Ensure “And more...” appears at end of release notes
5. Sync dev to main after release
