"""Domain errors that the API maps to HTTP status codes."""


class NotFound(KeyError):
    """404: the requested record does not exist."""

    def __str__(self) -> str:
        return str(self.args[0]) if self.args else "Not found"


class Conflict(Exception):
    """409: the action is not valid in the current state."""


class Forbidden(Exception):
    """403: the record cannot be changed."""
