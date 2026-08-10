import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="center">
          <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
            <h2>Coś poszło nie tak</h2>
            <p className="muted">
              Wystąpił błąd ({String(this.state.error && this.state.error.message)}).
              Odśwież stronę lub wróć do poprzedniej zakładki.
            </p>
            <button className="btn primary" onClick={() => this.setState({ error: null })}>
              Spróbuj ponownie
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
