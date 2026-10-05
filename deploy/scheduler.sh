#!/bin/sh
# Runs inside the scheduler container. Checks every 5 minutes (times in UTC):
#   01:00 UTC = 06:30 India time: daily jobs (reminders, autopay, risk scores, device sync…)
#   20:30 UTC = 02:00 India time: backup of the database and member files, keeping KEEP_DAYS days
#   every hour: AI Trainer push reminders (each one goes once a day, in its own window)
#   Saturday 21:00 UTC = Sunday 02:30 India time: restore test of every gym's latest backup (rolled back; holds the gym's rows briefly)
set -u
mkdir -p /backups
state=/backups/.state
touch "$state"
last() { grep "^$1=" "$state" | cut -d= -f2; }
mark() { grep -v "^$1=" "$state" > "$state.tmp"; echo "$1=$2" >> "$state.tmp"; mv "$state.tmp" "$state"; }

while true; do
  day=$(date -u +%F)
  hm=$(date -u +%H%M)
  if [ "$hm" -ge 0100 ] && [ "$(last jobs)" != "$day" ]; then
    if wget -q -O /backups/last-jobs.json --header "Authorization: Bearer $CRON_SECRET" http://app:3000/api/jobs/daily; then
      mark jobs "$day"; echo "$(date -u) daily jobs done"
    else
      echo "$(date -u) daily jobs failed; retrying in 5 minutes"
    fi
  fi
  hour=$(date -u +%F-%H)
  if [ "$(last trainer)" != "$hour" ]; then
    if wget -q -O /dev/null --header "Authorization: Bearer $CRON_SECRET" http://app:3000/api/jobs/trainer; then
      mark trainer "$hour"
    else
      echo "$(date -u) trainer reminders failed; retrying in 5 minutes"
    fi
  fi
  # %u is the weekday, 1 = Monday: 6 is Saturday. At 21:00 UTC that is already Sunday morning in India, the quietest time.
  if [ "$(date -u +%u)" = 6 ] && [ "$hm" -ge 2100 ] && [ "$(last restoretest)" != "$day" ]; then
    if wget -q -O /backups/last-restore-test.json --header "Authorization: Bearer $CRON_SECRET" http://app:3000/api/jobs/weekly; then
      mark restoretest "$day"; echo "$(date -u) restore test done"
    else
      echo "$(date -u) restore test failed; retrying in 5 minutes"
    fi
  fi
  if [ "$hm" -ge 2030 ] && [ "$(last backup)" != "$day" ]; then
    f="/backups/fitron-$(date -u +%Y%m%d-%H%M)"
    if pg_dump -h db -U fitron -d fitron -Fc -f "$f.dump" && tar -czf "$f-files.tar.gz" -C /data storage; then
      mark backup "$day"; echo "$(date -u) backup written: $f"
      find /backups -name 'fitron-*' -mtime +"$KEEP_DAYS" -delete
    else
      rm -f "$f.dump" "$f-files.tar.gz"; echo "$(date -u) backup failed; retrying in 5 minutes"
    fi
  fi
  sleep 300
done
