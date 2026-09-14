import test from "node:test";
import assert from "node:assert/strict";
import {
  __siteCheckInternals,
  normalizeGoldstoreDomain,
  siteScopeMatches,
} from "../src/services/site-check-service.js";

test("normalizes Goldstore slug and hostname", () => {
  assert.deepEqual(normalizeGoldstoreDomain("italy"), {
    hostname: "italy.goldstore.id",
    origin: "https://italy.goldstore.id",
  });
  assert.deepEqual(normalizeGoldstoreDomain("https://italy.goldstore.id"), {
    hostname: "italy.goldstore.id",
    origin: "https://italy.goldstore.id",
  });
});

test("rejects domains outside Goldstore", () => {
  assert.throws(() => normalizeGoldstoreDomain("example.com"), /Goldstore/);
  assert.throws(() => normalizeGoldstoreDomain("localhost"), /Goldstore/);
  assert.throws(() => normalizeGoldstoreDomain("https://italy.goldstore.id:8080"), /Goldstore/);
});

test("extracts NAGAGOLD frontend build metadata from compiled bundle", () => {
  const metadata = __siteCheckInternals.extractFrontendMetadata(
    'const app={buildMajor:3,buildMinor:8,buildRevision:0,buildFe:50,buildTag:"NEW RELEASE",branchName:"main"};',
  );
  assert.deepEqual(metadata, {
    version: "3.8.0.50",
    base_version: "3.8.0",
    branch: "main",
  });
});

test("extracts minified NAGAGOLD frontend version constants", () => {
  const metadata = __siteCheckInternals.extractFrontendMetadata(
    'const yJ=3,_J=8,vJ=5,kJ=61,xJ="NEW RELEASE"; let version=`${yJ}.${_J}.${vJ}`,full=`${version}.${kJ}`;',
  );
  assert.deepEqual(metadata, {
    version: "3.8.5.61",
    base_version: "3.8.5",
    branch: "",
  });
});

test("site scope only matches the current domain and version snapshot", () => {
  const current = {
    domain: "italy.goldstore.id",
    frontend: { base_version: "3.8.0", branch: "main" },
    backend: { base_version: "3.8.0", branch: "" },
  };
  assert.equal(siteScopeMatches({
    domain: "italy.goldstore.id",
    frontendVersion: "3.8.0",
    backendVersion: "3.8.0",
    frontendBranch: "main",
  }, current), true);
  assert.equal(siteScopeMatches({
    domain: "italy.goldstore.id",
    frontendVersion: "3.7.0",
  }, current), false);
  assert.equal(siteScopeMatches(null, current), true);
});
