import { Route, Routes } from 'react-router-dom';
import { StudentsPage } from '../admin/Students';
import { StudentProfile } from './Profile';
import { ImportStudents } from './Import';

/** Students module. Mounted at /students/* (list, profile, import). */
export function StudentsModule() {
  return (
    <Routes>
      <Route index element={<StudentsPage />} />
      <Route path="import" element={<ImportStudents />} />
      <Route path=":id" element={<StudentProfile />} />
    </Routes>
  );
}
