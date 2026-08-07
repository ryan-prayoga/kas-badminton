package domain

// Error adalah error domain dengan HTTP status — handler HTTP (F2) memetakan
// ini ke response {error}. Port dari v2/lib/domain/errors.ts.
type Error struct {
	Message string
	Status  int
}

func (e *Error) Error() string { return e.Message }

func NewError(message string, status int) *Error {
	if status == 0 {
		status = 400
	}
	return &Error{Message: message, Status: status}
}
