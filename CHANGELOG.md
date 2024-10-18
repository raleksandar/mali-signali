# `mali-signali` Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `untracked()` - A function that reads the value of a signal without tracking it.
- `structuralEqual()` - a structural equality function which uses `Object.is()` semantics.
- `looseStructuralEqual()` - a structural equality function which uses `==` semantics.

### Changed
- The `SignalOptions.equals` option now defaults to `structuralEqual()` instead of `Object.is()`.
- The tuple returned by `signal()` is now typed as `readonly`.

## [1.0.0] - 2024-09-19
### Added
- Initial release

[Unreleased]: https://github.com/raleksandar/mali-signali/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/raleksandar/mali-signali/releases/tag/v1.0.0