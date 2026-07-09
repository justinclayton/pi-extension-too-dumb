.PHONY: release patch minor major publish dry-run

# Dry run to see what would be published
dry-run:
	npm publish --dry-run

# Publish current version
publish:
	npm publish --access public

# Bump patch version, commit, tag, and publish
patch:
	npm version patch
	git push --follow-tags
	npm publish --access public

# Bump minor version, commit, tag, and publish
minor:
	npm version minor
	git push --follow-tags
	npm publish --access public

# Bump major version, commit, tag, and publish
major:
	npm version major
	git push --follow-tags
	npm publish --access public
