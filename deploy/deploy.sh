#!/usr/bin/env bash
# Puts the version that is checked out here into service, on the machine
# the app runs on.
#
# .github/workflows/deploy.yml brings this checkout up to the commit that
# passed the tests and then runs this file, so the script that runs is
# always the one that came with the code. It can be run by hand as well:
#
#   bash deploy/deploy.sh [the commit that was in service before]
#
# The service is stopped while the app is built, and Caddy shows the
# maintenance page meanwhile. Before the new version gets to migrate the
# database, a copy of it is put aside.

set -euo pipefail

SERVICE=odyssey
KEEP_BACKUPS=10

main() {
	local previous="${1:-}"
	local bun="${BUN:-$HOME/.bun/bin/bun}"
	local log="${DEPLOY_LOG:-$HOME/deploy.log}"
	local saved=""
	cd "$(dirname "${BASH_SOURCE[0]}")/.."

	# What happened, for the log on this machine and for whoever is watching.
	note() { echo "$(date -Is) $*" | tee -a "$log" >&2; }

	# What `.env` says a setting is. Empty when it doesn't say.
	setting() {
		[ -f .env ] || return 0
		sed -n "s/^$1=//p" .env | head -n 1 | tr -d "\"' \r"
	}

	# Copies the database aside, as it is before this version's migrations
	# touch it, and says where. SQLite makes the copy, so it is whole even if
	# the server's own backup happens to be reading the database just then.
	backup() {
		local data into
		data=$(setting DATA_DIR)
		data="${data:-data}"
		if [ ! -f "$data/odyssey.db" ]; then
			note "no $data/odyssey.db here, so nothing was backed up"
			return 0
		fi
		into="backups/deploy/$(date +%Y-%m-%d_%H-%M-%S)"
		mkdir -p "$into" || return 1
		"$bun" deploy/copy-database.ts "$data/odyssey.db" "$into/odyssey.db" >&2 || return 1
		# The newest few are kept.
		ls -1dt backups/deploy/*/ | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf --
		echo "$into"
	}

	# Back to what was in service: its build, and its code beside it. The
	# migrations are read from the checkout and not from the build, so an old
	# build must not start beside migrations it knows nothing of.
	go_back() {
		rm -rf build
		if [ -d build.prev ]; then mv build.prev build; fi
		if [ -n "$previous" ]; then
			git reset --quiet --keep "$previous" ||
				note "could not put the checkout back to $previous"
		fi
		sudo systemctl start "$SERVICE"
	}

	# Asks the app for its front page. The database is opened, and brought up
	# to date, by the first request after a start: an answer means the
	# migrations went through. 2 when `.env` doesn't say where the app listens.
	answers() {
		local host port
		host=$(setting HOST)
		port=$(setting PORT)
		[ -n "$port" ] || return 2
		case "$host" in '' | 0.0.0.0) host=127.0.0.1 ;; esac
		for _ in $(seq 1 30); do
			if curl -fsS -o /dev/null --max-time 10 "http://$host:$port/" 2>/dev/null; then
				return 0
			fi
			sleep 1
		done
		return 1
	}

	"$bun" install

	# Caddy can't read the home folder, so the maintenance page is copied out.
	sudo install -D -m 644 deploy/maintenance.html /var/www/maintenance/index.html

	# Keep the build that is in service, to go back to.
	rm -rf build.prev
	if [ -d build ]; then mv build build.prev; fi

	sudo systemctl stop "$SERVICE"

	if ! saved=$(backup); then
		note "FAILED to back the database up, restored previous version"
		go_back
		exit 1
	fi

	if ! "$bun" run build; then
		note "FAILED build, restored previous version"
		go_back
		exit 1
	fi
	rm -rf build.prev

	sudo systemctl start "$SERVICE"

	local version state=0
	version="$(git rev-parse --short HEAD) - $(git log -1 --format=%s)"
	answers || state=$?
	case "$state" in
		0) note "deployed $version" ;;
		2) note "deployed $version (not checked: .env has no PORT)" ;;
		*)
			note "FAILED check: $version was started and does not answer." \
				"The database from before is in ${saved:-no backup}"
			exit 1
			;;
	esac
}

# On one line, so that nothing more of this file is read once it has run:
# going back to an earlier commit may change the file under it.
main "$@"; exit
