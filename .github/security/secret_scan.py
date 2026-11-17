#!/usr/bin/env python3
"""Run pinned Gitleaks without printing matches or uploading credential reports.

The only automatic false-positive exception is an exact JWT whose decoded
claims have Supabase's public anon-key shape. Signature validation is not used:
this classifies public configuration, never authorizes a request.
"""
import base64
import collections
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def public_supabase_anon(value):
    if not isinstance(value, str) or len(value) > 16384:
        return False
    parts = value.split('.')
    if len(parts) != 3 or not all(re.fullmatch(r'[A-Za-z0-9_-]+', p) for p in parts):
        return False
    try:
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
    except (ValueError, TypeError, UnicodeError):
        return False
    return (isinstance(claims, dict)
            and claims.get('iss') == 'supabase'
            and claims.get('role') == 'anon'
            and re.fullmatch(r'[a-z0-9]{20}', str(claims.get('ref', ''))) is not None
            and set(claims) <= {'iss', 'ref', 'role', 'iat', 'exp'}
            and type(claims.get('iat')) is int
            and type(claims.get('exp')) is int
            and claims['exp'] > claims['iat'])


def summarize(findings):
    if not isinstance(findings, list):
        raise ValueError('invalid scanner report')
    counts = collections.Counter()
    public_count = 0
    for item in findings:
        if not isinstance(item, dict) or not isinstance(item.get('RuleID'), str):
            raise ValueError('invalid scanner finding')
        rule = item['RuleID']
        if rule in {'jwt', 'generic-api-key'} and public_supabase_anon(item.get('Secret')):
            public_count += 1
            continue
        # No source line, match, secret, path, author, or commit message is emitted.
        safe_rule = rule if re.fullmatch(r'[a-z0-9-]{1,100}', rule) else 'unrecognized-rule'
        counts[safe_rule] += 1
    return {'findings_by_rule': dict(sorted(counts.items())),
            'public_anon_findings_accepted': public_count,
            'finding_count': sum(counts.values())}


def run_scan(binary, repo, config, mode, scratch):
    report = scratch / (mode + '.json')
    # Gitleaks' raw JSON stays only in this mode-0700 ephemeral directory so exact
    # public anon JWTs can be classified. Never publish it or print scanner output.
    common = ['--config', str(config), '--report-format', 'json',
              '--report-path', str(report), '--exit-code', '42', '--no-banner',
              '--ignore-gitleaks-allow', '--gitleaks-ignore-path', str(scratch),
              '--max-decode-depth', '5', '--timeout', '900']
    command = [str(binary), mode, *common]
    if mode == 'git':
        command += ['--log-opts=--all']
    command.append(str(repo))
    env = os.environ.copy()
    env.pop('GITLEAKS_CONFIG', None)
    env.pop('GITLEAKS_CONFIG_TOML', None)
    result = subprocess.run(command, env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=930, check=False)
    if result.returncode not in (0, 42) or not report.is_file():
        raise ValueError('scanner failed or omitted report')
    findings = json.loads(report.read_text())
    summary = summarize(findings)
    if result.returncode == 42 and not findings:
        raise ValueError('inconsistent scanner result')
    return summary


def main():
    os.umask(0o077)
    if len(sys.argv) != 2:
        print('Secret scan configuration error; no scanner output is published.')
        return 2
    root = Path.cwd()
    config = Path(__file__).with_name('secret-scan.toml').resolve()
    try:
        with tempfile.TemporaryDirectory(prefix='source-secret-audit-') as path:
            scratch = Path(path)
            summaries = {mode: run_scan(Path(sys.argv[1]).resolve(), root, config, mode, scratch)
                         for mode in ('git', 'dir')}
        print(json.dumps({'scope': 'fetched-git-history-and-current-files', 'results': summaries}, sort_keys=True))
        return int(any(s['finding_count'] for s in summaries.values()))
    except (ValueError, OSError, subprocess.SubprocessError):
        # No exception detail: scanner errors can contain credential-bearing data.
        print('Secret scan failed to complete; no scanner output is published.')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
