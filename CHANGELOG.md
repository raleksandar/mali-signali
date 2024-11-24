# `mali-signali` Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
### Added
- `EffectContext` - An effect context object with a `cancel()` function that can be used to cancel the effect.

## [1.1.0] - 2024-10-18
### Added
- `untracked()` - A function that reads the value of a signal without tracking it.
- `signal` option to `effect()` and `memo()` - An instance of `AbortSignal` that can be used to unlink all dependencies when the signal is aborted.
- `structuralEqual()` - a structural equality function which uses `Object.is()` semantics.
- `looseStructuralEqual()` - a structural equality function which uses `==` semantics.

### Changed
- The `SignalOptions.equals` option now defaults to `structuralEqual()` instead of `Object.is()`.
- The tuple returned by `signal()` is now typed as `readonly`.

## [1.0.0] - 2024-09-19
### Added
- Initial release

[Unreleased]: https://github.com/raleksandar/mali-signali/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/raleksandar/mali-signali/releases/tag/v1.1.0
[1.0.0]: https://github.com/raleksandar/mali-signali/releases/tag/v1.0.0