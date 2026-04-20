"""Table-driven tests for classify_tool_severity."""
import pytest

from agent_bridge import classify_tool_severity


# ---- tool-name-based classification ----------------------------------------

@pytest.mark.parametrize(
    "tool_name,args,expected",
    [
        # read tier by tool name
        ("read_file", {"path": "/tmp/x"}, "read"),
        ("list_files", {"path": "/tmp"}, "read"),
        ("grep", {"pattern": "foo"}, "read"),
        ("glob", {"pattern": "**/*.py"}, "read"),
        # write tier by tool name
        ("write_file", {"path": "/tmp/x", "content": "y"}, "write"),
        ("edit_file", {"path": "/tmp/x"}, "write"),
        ("create_file", {"path": "/tmp/x"}, "write"),
        # destructive by tool name
        ("delete_file", {"path": "/tmp/x"}, "destructive"),
        ("rmdir", {"path": "/tmp/x"}, "destructive"),
        # network by tool name
        ("http_get", {"url": "https://example.com"}, "network"),
        ("http_post", {"url": "https://example.com"}, "network"),
        ("fetch", {"url": "https://example.com"}, "network"),
    ],
)
def test_tool_name_classification(tool_name, args, expected):
    assert classify_tool_severity(tool_name, args) == expected


# ---- URL-in-args fallback --------------------------------------------------

def test_url_in_args_maps_to_network():
    assert classify_tool_severity("unknown_tool", {"target": "https://x.com/y"}) == "network"
    assert classify_tool_severity("unknown_tool", {"target": "http://x.com/"}) == "network"


# ---- shell parser (terminal tool) ------------------------------------------

@pytest.mark.parametrize(
    "command,expected",
    [
        # destructive
        ("rm -rf /tmp/x", "destructive"),
        ("rm -r /tmp/x", "destructive"),
        ("  rm -rf ~/Desktop/photos  ", "destructive"),  # leading/trailing ws
        ("mv /tmp/a /tmp/b", "destructive"),
        ("dd if=/dev/zero of=/tmp/x", "destructive"),
        ("git reset --hard origin/main", "destructive"),
        ("git push --force origin main", "destructive"),
        ("git push -f origin main", "destructive"),
        ("git push origin main -f", "destructive"),
        # network
        ("curl https://example.com", "network"),
        ("wget https://example.com/x.tar", "network"),
        ("ssh user@host", "network"),
        ("scp a b user@host:/tmp/", "network"),
        # write
        ("mkdir /tmp/x", "write"),
        ("touch /tmp/x", "write"),
        ("cp a b", "write"),
        ("sed -i 's/foo/bar/' file", "write"),
        # read
        ("ls -la", "read"),
        ("cat /etc/hosts", "read"),
        ("head -n 5 file", "read"),
        ("grep foo file", "read"),
        ("pwd", "read"),
        ("echo hello", "read"),
        # unknown
        ("somebinary --flag", "unknown"),
        ("cd /tmp && rm -rf foo", "unknown"),  # compound commands classified conservatively
        ("", "unknown"),  # empty command
    ],
)
def test_shell_parser(command, expected):
    assert classify_tool_severity("terminal", {"command": command}) == expected


def test_shell_tool_name_aliases():
    """The classifier should treat 'terminal', 'shell', 'bash', 'execute_command' equivalently."""
    assert classify_tool_severity("shell", {"command": "rm -rf x"}) == "destructive"
    assert classify_tool_severity("bash", {"command": "curl https://example.com"}) == "network"
    assert classify_tool_severity("execute_command", {"command": "ls -la"}) == "read"


# ---- edge cases ------------------------------------------------------------

def test_rm_without_dangerous_flag_is_still_destructive():
    """Bare `rm file` is still destructive even without -rf."""
    assert classify_tool_severity("terminal", {"command": "rm /tmp/x"}) == "destructive"


def test_git_push_without_force_is_not_destructive():
    """Regular git push is not destructive."""
    assert classify_tool_severity("terminal", {"command": "git push origin main"}) == "unknown"


def test_terminal_without_command_arg_is_unknown():
    assert classify_tool_severity("terminal", {}) == "unknown"
    assert classify_tool_severity("terminal", {"command": None}) == "unknown"


def test_fallback_is_unknown():
    assert classify_tool_severity("completely_novel_tool", {"foo": "bar"}) == "unknown"
