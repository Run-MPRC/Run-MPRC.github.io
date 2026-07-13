import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import parse from 'html-react-parser';
import { useServiceLocator } from '../services/ServiceLocatorContext';
import {
  clientFailureEvents,
  reportClientFailure,
} from '../services/monitoring/clientDiagnostics';

// This legacy JSX component predates typed props; adding a dependency or
// migrating the component is outside this privacy-only change.
// eslint-disable-next-line react/prop-types
function MembersOnly({ dataKey, style }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { services, isReady } = useServiceLocator();

  const documentId = 'x2ot5EAuuTvW02ZzkmEO';

  useEffect(() => {
    if (!isReady || !services) {
      return;
    }

    const db = services.firebaseResources.firestore;
    const fetchData = async () => {
      try {
        const docRef = doc(db, 'members_only', documentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const map = docSnap.data();
          setData(map[dataKey] || []);
        } else {
          setError('Document not found');
        }
      } catch {
        setError('Failed to fetch data');
        reportClientFailure(clientFailureEvents.membersOnlyFetchFailed);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [services, isReady, dataKey]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return (
      <div className="error">
        Error:
        {error}
      </div>
    );
  }

  return <div style={style}>{data && parse(data)}</div>;
}

export default MembersOnly;
