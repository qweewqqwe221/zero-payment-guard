"""Offline tests for x402_preflight.check_option. Run: python3 -m unittest discover -s tests"""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from x402_preflight import check_option, RPC

RPC.clear()  # no network calls in tests
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"


def opt(**k):
    o = {"scheme": "exact", "network": "eip155:8453", "asset": BASE_USDC, "amount": "3000",
         "payTo": "0x" + "1" * 40, "maxTimeoutSeconds": 120}
    o.update(k)
    return o


class PreflightTests(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(check_option(opt(), 0.01)["verdict"], "ok")

    def test_fake_usdc_blocks(self):
        self.assertEqual(check_option(opt(asset="0x" + "2" * 40), None)["verdict"], "block")

    def test_bridged_caution(self):
        r = check_option(opt(asset="0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"), None)
        self.assertEqual(r["verdict"], "caution")

    def test_price_cap(self):
        self.assertEqual(check_option(opt(amount="50000000"), 1.0)["verdict"], "block")

    def test_long_timeout(self):
        self.assertEqual(check_option(opt(maxTimeoutSeconds=86400), None)["verdict"], "caution")

    def test_v1_network_name(self):
        r = check_option(opt(network="base", amount=None, maxAmountRequired="1000"), None)
        self.assertEqual(r["priceUsd"], 0.001)

    def test_unknown_scheme(self):
        self.assertEqual(check_option(opt(scheme="upto"), None)["verdict"], "caution")


if __name__ == "__main__":
    unittest.main()
