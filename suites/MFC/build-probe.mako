<%!
import json
import os
%>
${json.dumps([{"name": t.name, "binary": t.get_install_binpath(case), "installed": t.is_installed(case) and os.access(t.get_install_binpath(case), os.X_OK)} for t in targets])}
