import React, { useState } from 'react';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import Header from '../../components/Header';
import FlexColumnContainer from '../../components/FlexColumnContainer';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import SEO from '../../components/SEO';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { services, isReady } = useServiceLocator();
  const [currentUser, setCurrentUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isReady || !services) {
      setError('Services not ready. Please try again.');
      return;
    }

    setIsLoading(true);

    try {
      const { identityService } = services;
      if (isRegistering) {
        const credential = await identityService.register(email, password);
        setCurrentUser(credential.user);
      } else {
        const credential = await identityService.signIn(email, password);
        setCurrentUser(credential.user);
      }
    } catch (loginError) {
      setError('Failed to authenticate. Please check your credentials and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMode = () => {
    setIsRegistering(!isRegistering);
    setError('');
    setCurrentUser(null);
  };

  return (
    <div>
      <SEO title="Member Login" noindex />
      <Header
        title={isRegistering ? 'Register' : 'Login'}
        image={HeaderImage}
      />
      {error && (
        <div className="error-message" style={{ color: 'red', textAlign: 'center', padding: '1rem' }}>
          {error}
        </div>
      )}
      <FlexColumnContainer style={{ alignItems: 'center' }}>
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: '300px',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <input
            type="email"
            placeholder="Email"
            aria-label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isLoading}
            style={{
              marginBottom: '10px',
              padding: '0.5rem',
              width: '100%',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            style={{
              marginBottom: '10px',
              padding: '0.5rem',
              width: '100%',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Processing...' : (isRegistering ? 'Register' : 'Login')}
          </button>
          {currentUser && (
            <p style={{ color: 'green', textAlign: 'center' }}>
              Welcome,
              {' '}
              {currentUser.email}
              !
            </p>
          )}
          <button
            type="button"
            onClick={handleToggleMode}
            disabled={isLoading}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: 'transparent',
              color: '#007bff',
              border: '1px solid #007bff',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isRegistering ? 'Switch to Login' : 'Switch to Register'}
          </button>
        </form>
      </FlexColumnContainer>
    </div>
  );
}

export default LoginForm;
