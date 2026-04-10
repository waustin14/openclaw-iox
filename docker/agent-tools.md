# Available Tools

## cisco-pyats

Run show commands and push configuration to Cisco IOS XE devices via pyATS/Genie.

The testbed at /root/.openclaw/testbed.yaml is pre-configured for the target device using SSH key auth at /root/.openclaw/ssh/id_ed25519.

Use this to:
- Execute show commands and get structured or raw output
- Push configuration blocks (use configure mode)
- Learn interface, BGP, OSPF, routing table state via Genie parsers

## Webex

Send messages to the Cisco Webex room via the configured bot. The default room is pre-configured.

Use Webex to:
- Send immediate event notifications
- Report pyATS findings
- Ask for human guidance when remediation is ambiguous
- Confirm completed actions
