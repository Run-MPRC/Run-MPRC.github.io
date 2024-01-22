import React, { useContext, useState } from 'react';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import Header from '../../components/Header';
import FlexColumnContainer from '../../components/FlexColumnContainer';
import ServiceLocatorContext from '../../services/ServiceLocatorContext';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { identityService } = useContext(ServiceLocatorContext);
  const [currentUser, setCurrentUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  // New state to toggle between login and registration
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (isRegistering) {
        const user = await identityService.register(email, password);
        // Adjust method name as per your service
        setCurrentUser(user);
      } else {
        const user = await identityService.signIn(email, password);
        // Adjust method name as per your service
        setCurrentUser(user);
      }
    } catch (loginError) {
      // console.error('Login error:', loginError);
      setError('Failed to login. Please check your credentials and try again.');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const user = await identityService.register(email, password);
      // Adjust method name as per your service
      // console.log(user);
      setCurrentUser(user);
    } catch (registerError) {
      // console.error('Registration error:', registerError);
      setError(
        'Failed to register. Please check your credentials and try again.',
      );
    }
  };

  return (
    <div>
      <Header
        title={isRegistering ? 'Register' : 'Login'}
        image={HeaderImage}
      />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <FlexColumnContainer style={{ alignItems: 'center' }}>
        <form
          onSubmit={isRegistering ? handleRegister : handleLogin}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: '300px',
            alignItems: 'center',
          }}
        >
          <input
            type="email"
            placeholder="Email"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginBottom: '10px' }}
          />
          <input
            type="password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginBottom: '10px' }}
          />
          <button type="submit">{isRegistering ? 'Register' : 'Login'}</button>
          {currentUser && (
          <p>
            Welcome,
            {currentUser.name}
            !
          </p>
          )}
          <button
            type="button"
            onClick={() => setIsRegistering(!isRegistering)}
          >
            {isRegistering ? 'Switch to Login' : 'Switch to Register'}
          </button>
        </form>
      </FlexColumnContainer>
    </div>
  );
}

export default LoginForm;
